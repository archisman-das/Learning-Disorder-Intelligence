from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import pandas as pd
import numpy as np
import torch
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, precision_score, recall_score
from torch import nn
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.calibration import fit_temperature
from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.cross_lingual import set_trainable_by_prefix, shared_feature_distillation_loss, transfer_matching_weights
from src.dyslexia_detection.dataset import DyslexiaManifestDataset
from src.dyslexia_detection.models import build_model
from src.dyslexia_detection.train import _class_weights, collect_logits_and_labels, evaluate


SUPPORTED_MODELS = [
    "cnn",
    "lstm",
    "cnn_lstm",
    "transformer",
    "vit",
    "vit_transformer",
    "multimodal",
    "multimodal_attention",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Select a model on the hard split and report final-eval metrics.")
    parser.add_argument("--train-manifest", required=True)
    parser.add_argument("--validation-manifest", required=True)
    parser.add_argument("--final-eval-manifest", required=True)
    parser.add_argument("--task", default="binary", choices=["binary", "severity", "regression"])
    parser.add_argument("--text-language", default="multilingual", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--models", nargs="+", default=["cnn_lstm", "transformer", "vit_transformer", "multimodal_attention"], choices=SUPPORTED_MODELS)
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=5e-4)
    parser.add_argument("--weight-decay", type=float, default=5e-4)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--label-smoothing", type=float, default=0.1)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    parser.add_argument("--checkpoint-root", default="checkpoints/hard_split_selection_balanced_harder")
    parser.add_argument("--best-alias-path", default="checkpoints/best_model.pt")
    parser.add_argument("--selection-metric", default="score")
    parser.add_argument(
        "--final-threshold-mode",
        default="default",
        choices=["default", "tuned"],
        help="Which thresholded final-eval metrics should be treated as the primary report. Default keeps the raw 0.5 threshold as the main score to reduce overfitting.",
    )
    parser.add_argument(
        "--threshold-objective",
        default="recall",
        choices=["precision_heavy", "f1", "f2", "recall"],
        help="How to tune the binary decision threshold on validation logits. Default is recall-oriented.",
    )
    parser.add_argument(
        "--min-precision",
        type=float,
        default=0.65,
        help="Lower bound on validation precision when optimizing for recall-oriented strict runs.",
    )
    parser.add_argument("--pretrained-audio-encoder", default="")
    parser.add_argument("--transfer-checkpoint", default="")
    parser.add_argument("--transfer-prefixes", default="handwriting.,audio.,behavior.,classifier.")
    parser.add_argument("--freeze-transferred-epochs", type=int, default=0)
    parser.add_argument("--distill-checkpoint", default="")
    parser.add_argument("--distill-weight", type=float, default=0.0)
    parser.add_argument("--seed", type=int, default=42, help="Random seed used for model initialization and training order.")
    return parser.parse_args()


def _set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _load_dataset(path: str, text_language: str) -> DyslexiaManifestDataset:
    return DyslexiaManifestDataset(path, DataConfig(text_language=text_language))


def _prepare_model(
    *,
    args: argparse.Namespace,
    num_classes: int,
    device: torch.device,
) -> tuple[nn.Module, nn.Module | None]:
    data_config = DataConfig(text_language=args.text_language)
    model = build_model(args.model, data_config, num_classes=num_classes).to(device)

    transferred_prefixes = tuple(prefix.strip() for prefix in args.transfer_prefixes.split(",") if prefix.strip())
    if args.transfer_checkpoint:
        source_payload = torch.load(args.transfer_checkpoint, map_location="cpu")
        transfer_matching_weights(model, source_payload["model_state"], include_prefixes=transferred_prefixes)

    if args.pretrained_audio_encoder:
        ssl_payload = torch.load(args.pretrained_audio_encoder, map_location="cpu")
        encoder_state = ssl_payload.get("audio_encoder_state")
        if encoder_state is None:
            raise ValueError(f"Invalid SSL checkpoint (missing audio_encoder_state): {args.pretrained_audio_encoder}")
        if hasattr(model, "audio"):
            model.audio.load_state_dict(encoder_state, strict=True)

    teacher_model: nn.Module | None = None
    if args.distill_checkpoint and args.distill_weight > 0:
        teacher_payload = torch.load(args.distill_checkpoint, map_location="cpu")
        teacher_config = teacher_payload.get("data_config", DataConfig())
        if isinstance(teacher_config, dict):
            teacher_config = DataConfig(**teacher_config)
        teacher_model = build_model(
            teacher_payload.get("model_name", args.model),
            teacher_config,
            num_classes=int(teacher_payload.get("num_classes", num_classes)),
        ).to(device)
        transfer_matching_weights(teacher_model, teacher_payload["model_state"], include_prefixes=("handwriting.", "audio.", "behavior."))
        teacher_model.eval()

    return model, teacher_model


def _build_criterion(task: str, class_weights: torch.Tensor | None, label_smoothing: float) -> nn.Module:
    if task in {"binary", "severity"}:
        return nn.CrossEntropyLoss(weight=class_weights, label_smoothing=max(0.0, min(0.2, label_smoothing)))
    return nn.SmoothL1Loss()


def _search_binary_threshold(
    probabilities: torch.Tensor,
    labels: torch.Tensor,
    *,
    objective: str,
    min_precision: float,
) -> tuple[float, dict[str, float]]:
    if probabilities.numel() == 0 or labels.numel() == 0:
        return 0.5, {"accuracy": 0.0, "precision": 0.0, "recall": 0.0, "f1": 0.0, "balanced_accuracy": 0.0}

    thresholds = torch.linspace(0.05, 0.95, steps=37).tolist()
    labels_np = labels.cpu().numpy()
    probabilities_np = probabilities.cpu().numpy()
    best_threshold = 0.5
    best_score = float("-inf")
    best_metrics = {"accuracy": 0.0, "precision": 0.0, "recall": 0.0, "f1": 0.0, "balanced_accuracy": 0.0}

    for threshold in thresholds:
        predictions = (probabilities_np >= threshold).astype(int)
        precision = precision_score(labels_np, predictions, zero_division=0)
        recall = recall_score(labels_np, predictions, zero_division=0)
        f1 = f1_score(labels_np, predictions, zero_division=0)
        balanced = balanced_accuracy_score(labels_np, predictions)
        if objective == "precision_heavy":
            score = (f1 * 0.7) + (precision * 0.3)
        elif objective == "f1":
            score = f1
        elif objective == "f2":
            beta_sq = 4.0
            score = ((1 + beta_sq) * precision * recall / max((beta_sq * precision) + recall, 1e-8)) if (precision > 0 or recall > 0) else 0.0
        else:
            score = recall if precision >= min_precision else -1.0
        if score > best_score or (score == best_score and recall > best_metrics["recall"]):
            best_score = score
            best_threshold = float(threshold)
            best_metrics = {
                "accuracy": float(accuracy_score(labels_np, predictions)),
                "precision": float(precision),
                "recall": float(recall),
                "f1": float(f1),
                "balanced_accuracy": float(balanced),
            }

    return best_threshold, best_metrics


def _train_single_model(
    *,
    model_name: str,
    train_dataset: DyslexiaManifestDataset,
    validation_dataset: DyslexiaManifestDataset,
    args: argparse.Namespace,
    device: torch.device,
) -> dict[str, object]:
    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True)
    validation_loader = DataLoader(validation_dataset, batch_size=args.batch_size)
    num_classes = 2 if args.task == "binary" else 3 if args.task == "severity" else 1
    args_for_model = argparse.Namespace(**{**vars(args), "model": model_name})
    model, teacher_model = _prepare_model(args=args_for_model, num_classes=num_classes, device=device)
    train_labels = [int(value) for value in train_dataset.frame["label"].tolist()]
    class_weights = _class_weights(train_labels, num_classes, device)
    criterion = _build_criterion(args.task, class_weights, args.label_smoothing)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="max" if args.task != "regression" else "min",
        factor=0.5,
        patience=max(1, args.patience // 2),
        min_lr=max(args.learning_rate * 0.05, 1e-6),
    )

    best_score = float("-inf")
    best_payload: dict[str, object] | None = None
    epochs_without_improvement = 0
    history: list[dict[str, float]] = []

    for epoch in range(1, args.epochs + 1):
        if args.freeze_transferred_epochs > 0:
            if epoch <= args.freeze_transferred_epochs:
                set_trainable_by_prefix(model, ("text.", "classifier."))
            else:
                for parameter in model.parameters():
                    parameter.requires_grad = True

        model.train()
        total_loss = 0.0
        for batch in train_loader:
            batch = {key: value.to(device) for key, value in batch.items()}
            optimizer.zero_grad(set_to_none=True)
            logits = model(batch["image"], batch["audio"], batch["text"], batch["errors"], batch["behavior"])
            if args.task == "binary":
                loss = criterion(logits, batch["label"])
            elif args.task == "severity":
                loss = criterion(logits, batch["severity_label"])
            else:
                loss = criterion(logits.squeeze(1), batch["severity_score"])
            if teacher_model is not None and args.distill_weight > 0:
                loss = loss + (args.distill_weight * shared_feature_distillation_loss(
                    model,
                    teacher_model,
                    batch["image"],
                    batch["audio"],
                    batch["behavior"],
                ))
            loss.backward()
            if args.grad_clip_norm > 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=args.grad_clip_norm)
            optimizer.step()
            total_loss += float(loss.item())

        metrics = evaluate(model, validation_loader, device, args.task)
        history.append({"epoch": float(epoch), "loss": total_loss / max(1, len(train_loader)), **{f"val_{k}": float(v) for k, v in metrics.items() if k != "score"}})
        scheduler.step(metrics["mae"] if args.task == "regression" else metrics["score"])

        selection_score = metrics["f1"] if args.task == "binary" else metrics["score"]
        if selection_score > best_score:
            best_score = selection_score
            epochs_without_improvement = 0
            best_payload = {
                "model_name": model_name,
                "task": args.task,
                "num_classes": num_classes,
                "model_state": model.state_dict(),
                "data_config": DataConfig(text_language=args.text_language).__dict__,
                "metrics": metrics,
                "epoch": epoch,
            }
            if args.task != "regression":
                logits, labels = collect_logits_and_labels(model, validation_loader, device, args.task)
                calibration = fit_temperature(logits, labels)
                best_payload["temperature"] = float(calibration.temperature)
                best_payload["calibration_nll"] = float(calibration.nll)
                if args.task == "binary" and logits.numel() > 0:
                    validation_threshold, threshold_metrics = _search_binary_threshold(
                        torch.softmax(logits, dim=1)[:, 1],
                        labels,
                        objective=args.threshold_objective,
                        min_precision=args.min_precision,
                    )
                    best_payload["decision_threshold"] = float(validation_threshold)
                    best_payload["threshold_objective"] = args.threshold_objective
                    best_payload["min_precision"] = float(args.min_precision)
                    best_payload["threshold_metrics"] = threshold_metrics
        else:
            epochs_without_improvement += 1

        if args.patience > 0 and epochs_without_improvement >= args.patience:
            break

    if best_payload is None:
        raise RuntimeError(f"Training for {model_name} did not produce a checkpoint.")

    model.load_state_dict(best_payload["model_state"])
    return {"payload": best_payload, "history": history, "score": float(best_score)}


def _evaluate_final(model: nn.Module, loader: DataLoader, device: torch.device, task: str, decision_threshold: float) -> dict[str, float]:
    model.eval()
    labels: list[int] = []
    predictions: list[int] = []
    confidences: list[float] = []
    probabilities: list[float] = []
    with torch.no_grad():
        for batch in loader:
            batch = {key: value.to(device) for key, value in batch.items()}
            logits = model(batch["image"], batch["audio"], batch["text"], batch["errors"], batch["behavior"])
            if task == "binary":
                probs = torch.softmax(logits, dim=1)
                batch_predictions = (probs[:, 1] >= decision_threshold).long()
                confidences.extend(probs.max(dim=1).values.cpu().tolist())
                probabilities.extend(probs[:, 1].cpu().tolist())
            else:
                probs = torch.softmax(logits, dim=1)
                batch_predictions = probs.argmax(dim=1)
                confidences.extend(probs.max(dim=1).values.cpu().tolist())
            labels.extend(batch["label"].cpu().tolist())
            predictions.extend(batch_predictions.cpu().tolist())

    averaging = "binary" if task == "binary" else "macro"
    metrics = {
        "accuracy": float(accuracy_score(labels, predictions)),
        "precision": float(precision_score(labels, predictions, average=averaging, zero_division=0)),
        "recall": float(recall_score(labels, predictions, average=averaging, zero_division=0)),
        "f1": float(f1_score(labels, predictions, average=averaging, zero_division=0)),
        "balanced_accuracy": float(balanced_accuracy_score(labels, predictions)),
        "mean_confidence": float(sum(confidences) / max(1, len(confidences))),
    }
    if task == "binary":
        metrics["positive_probability_mean"] = float(sum(probabilities) / max(1, len(probabilities)))
        metrics["score"] = metrics["f1"]
        metrics["decision_threshold"] = float(decision_threshold)
    else:
        metrics["score"] = metrics["f1"]
    return metrics


def main() -> None:
    args = parse_args()
    _set_seed(args.seed)
    train_path = Path(args.train_manifest)
    validation_path = Path(args.validation_manifest)
    final_eval_path = Path(args.final_eval_manifest)
    for path in (train_path, validation_path, final_eval_path):
        if not path.exists():
            raise SystemExit(f"Manifest not found: {path}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    output_root = Path(args.checkpoint_root)
    output_root.mkdir(parents=True, exist_ok=True)

    train_dataset = _load_dataset(str(train_path), args.text_language)
    validation_dataset = _load_dataset(str(validation_path), args.text_language)
    final_dataset = _load_dataset(str(final_eval_path), args.text_language)
    final_loader = DataLoader(final_dataset, batch_size=args.batch_size)

    ranking_rows: list[dict[str, object]] = []
    for model_name in args.models:
        model_root = output_root / "cv" / model_name
        model_root.mkdir(parents=True, exist_ok=True)
        result = _train_single_model(
            model_name=model_name,
            train_dataset=train_dataset,
            validation_dataset=validation_dataset,
            args=args,
            device=device,
        )
        payload = dict(result["payload"])
        torch.save(payload, model_root / "best_model.pt")
        (model_root / "training_history.csv").write_text(pd.DataFrame(result["history"]).to_csv(index=False), encoding="utf-8")
        ranking_rows.append(
            {
                "model": model_name,
                "selection_value": float(payload["metrics"].get(args.selection_metric, payload["metrics"].get("score", 0.0))),
                "payload": payload,
                "root": model_root,
            }
        )
        print(f"model={model_name} validation_score={float(payload['metrics'].get('score', 0.0)):.4f}", flush=True)

    ranked = sorted(ranking_rows, key=lambda row: float(row["selection_value"]), reverse=True)
    best = ranked[0]
    best_model = str(best["model"])
    best_payload = dict(best["payload"])
    best_checkpoint = Path(best["root"]) / "best_model.pt"
    payload = torch.load(best_checkpoint, map_location=device)
    model, _ = _prepare_model(
        args=argparse.Namespace(**{**vars(args), "model": best_model}),
        num_classes=int(payload.get("num_classes", 2)),
        device=device,
    )
    model.load_state_dict(payload["model_state"])
    decision_threshold = float(payload.get("decision_threshold", 0.5))
    tuned_final_metrics = _evaluate_final(model, final_loader, device, args.task, decision_threshold)
    default_final_metrics = _evaluate_final(model, final_loader, device, args.task, 0.5)
    primary_final_metrics = default_final_metrics if args.final_threshold_mode == "default" else tuned_final_metrics
    best_payload["final_eval_metrics"] = primary_final_metrics
    best_payload["final_eval_metrics_default_threshold"] = default_final_metrics
    best_payload["final_eval_metrics_tuned_threshold"] = tuned_final_metrics
    best_payload["final_threshold_mode"] = args.final_threshold_mode
    if args.task == "binary":
        tuned_f1 = float(tuned_final_metrics["f1"])
        default_f1 = float(default_final_metrics["f1"])
        threshold_warning = {
            "enabled": bool(abs(tuned_f1 - default_f1) >= 0.15 or decision_threshold < 0.2),
            "message": (
                "Calibrated-threshold metrics are much better than the raw 0.5-threshold metrics; "
                "this often means the reported final score is threshold-sensitive."
            ),
        }
        best_payload["threshold_comparison"] = {
            "validation_threshold": float(decision_threshold),
            "validation_threshold_metrics": dict(payload.get("threshold_metrics", {})),
            "default_threshold": 0.5,
            "default_threshold_metrics": default_final_metrics,
            "tuned_threshold_metrics": tuned_final_metrics,
            "warning": threshold_warning,
        }
    best_payload["final_eval_manifest"] = str(final_eval_path)
    best_payload["validation_manifest"] = str(validation_path)
    best_payload["train_manifest"] = str(train_path)
    torch.save(best_payload, output_root / "best_model.pt")
    alias_path = Path(args.best_alias_path).expanduser()
    alias_path.parent.mkdir(parents=True, exist_ok=True)
    alias_payload = dict(best_payload)
    alias_payload["selected_model_name"] = best_model
    alias_payload["source_checkpoint"] = str(output_root / "best_model.pt")
    torch.save(alias_payload, alias_path)
    report = {
        "selected_model": best_model,
        "train_manifest": str(train_path),
        "validation_manifest": str(validation_path),
        "final_eval_manifest": str(final_eval_path),
        "ranking": [
            {"model": row["model"], "selection_value": float(row["selection_value"])}
            for row in ranked
        ],
        "final_threshold_mode": args.final_threshold_mode,
        "final_eval_metrics": primary_final_metrics,
        "final_eval_metrics_default_threshold": default_final_metrics,
        "final_eval_metrics_tuned_threshold": tuned_final_metrics,
        "best_alias_path": str(alias_path),
    }
    if args.task == "binary":
        report["threshold_comparison"] = best_payload["threshold_comparison"]
        if best_payload["threshold_comparison"]["warning"]["enabled"]:
            print("threshold_warning=calibration_is_material", flush=True)
    (output_root / "hard_split_selection_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"selected_model={best_model}", flush=True)
    print(f"final_eval_threshold_mode={args.final_threshold_mode}", flush=True)
    print(f"final_eval_tuned_threshold={float(decision_threshold):.4f}", flush=True)
    print(f"final_eval_f1={float(primary_final_metrics['f1']):.4f}", flush=True)
    print(f"final_eval_mean_confidence={float(primary_final_metrics['mean_confidence']):.4f}", flush=True)
    print(f"final_eval_accuracy={float(primary_final_metrics['accuracy']):.4f}", flush=True)
    print(f"final_eval_precision={float(primary_final_metrics['precision']):.4f}", flush=True)
    print(f"final_eval_recall={float(primary_final_metrics['recall']):.4f}", flush=True)
    if args.task == "binary":
        print(f"final_eval_default_threshold=0.5000", flush=True)
        print(f"final_eval_default_f1={float(default_final_metrics['f1']):.4f}", flush=True)
        print(f"final_eval_default_precision={float(default_final_metrics['precision']):.4f}", flush=True)
        print(f"final_eval_default_recall={float(default_final_metrics['recall']):.4f}", flush=True)
        print(f"final_eval_tuned_f1={float(tuned_final_metrics['f1']):.4f}", flush=True)
        print(f"final_eval_tuned_precision={float(tuned_final_metrics['precision']):.4f}", flush=True)
        print(f"final_eval_tuned_recall={float(tuned_final_metrics['recall']):.4f}", flush=True)


if __name__ == "__main__":
    main()
