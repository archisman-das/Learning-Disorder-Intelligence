from __future__ import annotations

import argparse
import json
import re
import statistics
import random
import sys
from pathlib import Path

import pandas as pd
import numpy as np
import torch
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, mean_absolute_error, precision_score, recall_score
from torch import nn
from torch.utils.data import DataLoader, Subset

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.calibration import fit_temperature
from src.dyslexia_detection.config import DataConfig, TrainConfig
from src.dyslexia_detection.cross_lingual import set_trainable_by_prefix, shared_feature_distillation_loss, transfer_matching_weights
from src.dyslexia_detection.dataset import DyslexiaManifestDataset
from src.dyslexia_detection.models import build_model
from src.dyslexia_detection.train import _best_binary_threshold, _class_weights, binary_metrics_at_threshold, build_training_loader, collect_logits_and_labels, evaluate, split_binary_calibration_evaluation

try:
    from sklearn.model_selection import GroupKFold, StratifiedGroupKFold
except ImportError:  # pragma: no cover - older sklearn fallback
    from sklearn.model_selection import GroupKFold  # type: ignore[no-redef]
    StratifiedGroupKFold = None  # type: ignore[assignment]


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
    parser = argparse.ArgumentParser(description="Run family-safe cross-validation for dyslexia screening models.")
    parser.add_argument("--manifest", required=True, help="Path to the prepared manifest CSV.")
    parser.add_argument("--model", default="multimodal_attention", choices=SUPPORTED_MODELS)
    parser.add_argument("--task", default="binary", choices=["binary", "severity", "regression"])
    parser.add_argument("--text-language", default="multilingual", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=TrainConfig.learning_rate)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--label-smoothing", type=float, default=0.05)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    parser.add_argument("--validation-fraction", type=float, default=0.2, help="Legacy alias for holdout fraction inside each fold.")
    parser.add_argument("--checkpoint-root", default="checkpoints/cross_validation")
    parser.add_argument("--save-fold-checkpoints", action="store_true")
    parser.add_argument("--pretrained-audio-encoder", default="")
    parser.add_argument("--transfer-checkpoint", default="")
    parser.add_argument("--transfer-prefixes", default="handwriting.,audio.,behavior.,classifier.")
    parser.add_argument("--freeze-transferred-epochs", type=int, default=0)
    parser.add_argument("--distill-checkpoint", default="")
    parser.add_argument("--distill-weight", type=float, default=0.0)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def _set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _sample_family(sample_id: object) -> str:
    family = str(sample_id).strip()
    if not family:
        return ""
    pattern = re.compile(r"(?:_audio)?_aug\d+$", re.IGNORECASE)
    while True:
        cleaned = pattern.sub("", family)
        if cleaned == family:
            return family
        family = cleaned


def _build_subset(dataset: DyslexiaManifestDataset, indices: list[int]) -> Subset[DyslexiaManifestDataset]:
    return Subset(dataset, indices)


def _family_frame(frame: pd.DataFrame) -> pd.DataFrame:
    grouped = frame.copy()
    grouped["_family_id"] = grouped["sample_id"].map(_sample_family)
    family_frame = grouped.drop_duplicates("_family_id", keep="first")[["_family_id", "label"]].copy()
    family_frame["label"] = pd.to_numeric(family_frame["label"], errors="coerce").fillna(0).astype(int)
    return family_frame


def _make_folds(frame: pd.DataFrame, task: str, folds: int, seed: int) -> list[tuple[list[int], list[int]]]:
    grouped = frame.copy()
    grouped["_family_id"] = grouped["sample_id"].map(_sample_family)
    family_frame = _family_frame(frame)
    if folds < 2:
        raise ValueError("folds must be at least 2")
    if len(family_frame) < folds:
        raise ValueError(f"Not enough unique families ({len(family_frame)}) for {folds}-fold cross-validation.")

    fold_assignments: list[tuple[list[int], list[int]]] = []
    if StratifiedGroupKFold is not None and family_frame["label"].nunique() > 1:
        splitter = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=seed)
        for train_family_idx, val_family_idx in splitter.split(
            family_frame["_family_id"],
            family_frame["label"],
            groups=family_frame["_family_id"],
        ):
            train_families = family_frame.iloc[train_family_idx]["_family_id"].tolist()
            val_families = family_frame.iloc[val_family_idx]["_family_id"].tolist()
            train_indices = grouped.index[grouped["_family_id"].isin(train_families)].tolist()
            val_indices = grouped.index[grouped["_family_id"].isin(val_families)].tolist()
            fold_assignments.append((train_indices, val_indices))
    else:
        splitter = GroupKFold(n_splits=folds)
        for train_family_idx, val_family_idx in splitter.split(
            family_frame["_family_id"],
            family_frame["label"],
            groups=family_frame["_family_id"],
        ):
            train_families = family_frame.iloc[train_family_idx]["_family_id"].tolist()
            val_families = family_frame.iloc[val_family_idx]["_family_id"].tolist()
            train_indices = grouped.index[grouped["_family_id"].isin(train_families)].tolist()
            val_indices = grouped.index[grouped["_family_id"].isin(val_families)].tolist()
            fold_assignments.append((train_indices, val_indices))
    return fold_assignments


def _build_criterion(task: str, class_weights: torch.Tensor | None, label_smoothing: float) -> nn.Module:
    if task in {"binary", "severity"}:
        return nn.CrossEntropyLoss(weight=class_weights, label_smoothing=max(0.0, min(0.2, label_smoothing)))
    return nn.SmoothL1Loss()


def _train_fold(
    *,
    dataset: DyslexiaManifestDataset,
    train_indices: list[int],
    val_indices: list[int],
    args: argparse.Namespace,
    repeat_id: int,
    fold_id: int,
    device: torch.device,
    output_root: Path,
) -> dict[str, float]:
    data_config = DataConfig(text_language=args.text_language)
    train_dataset = _build_subset(dataset, train_indices)
    val_dataset = _build_subset(dataset, val_indices)
    train_loader = build_training_loader(train_dataset, args.batch_size, args.task)
    val_loader = DataLoader(val_dataset, batch_size=args.batch_size)

    num_classes = 2 if args.task == "binary" else 3 if args.task == "severity" else 1
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

    train_labels = [int(dataset.frame.iloc[index]["label"]) for index in train_indices]
    class_weights = _class_weights(train_labels, num_classes, device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=TrainConfig.weight_decay)
    criterion = _build_criterion(args.task, class_weights, args.label_smoothing)
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

        metrics = evaluate(model, val_loader, device, args.task)
        mean_loss = total_loss / max(1, len(train_loader))
        row = {"epoch": float(epoch), "loss": mean_loss, **{f"val_{key}": float(value) for key, value in metrics.items() if key != "score"}}
        history.append(row)
        selection_score = metrics["f1"] if args.task == "binary" else metrics["score"]
        if args.task == "regression":
            scheduler.step(metrics["mae"])
        else:
            scheduler.step(selection_score)

        if selection_score > best_score:
            best_score = selection_score
            epochs_without_improvement = 0
            best_payload = {
                "model_name": args.model,
                "task": args.task,
                "num_classes": num_classes,
                "model_state": model.state_dict(),
                "data_config": data_config.__dict__,
                "metrics": metrics,
                "epoch": epoch,
            }
            if args.task != "regression":
                logits, labels = collect_logits_and_labels(model, val_loader, device, args.task)
                calibration = fit_temperature(logits, labels)
                best_payload["temperature"] = float(calibration.temperature)
                best_payload["calibration_nll"] = float(calibration.nll)
                if args.task == "binary" and logits.numel() > 0:
                    probabilities = torch.softmax(logits, dim=1)[:, 1]
                    calibration_probabilities, calibration_labels, evaluation_probabilities, evaluation_labels = split_binary_calibration_evaluation(
                        probabilities,
                        labels,
                        calibration_fraction=0.6,
                        seed=42 + repeat_id + fold_id,
                    )
                    validation_threshold, _ = _best_binary_threshold(calibration_probabilities, calibration_labels)
                    threshold_metrics = binary_metrics_at_threshold(evaluation_probabilities, evaluation_labels, validation_threshold)
                    best_payload["decision_threshold"] = float(validation_threshold)
                    best_payload["threshold_metrics"] = threshold_metrics
                    best_payload["metrics"] = threshold_metrics
            if args.save_fold_checkpoints:
                fold_dir = output_root / f"repeat_{repeat_id:02d}" / f"fold_{fold_id:02d}"
                fold_dir.mkdir(parents=True, exist_ok=True)
                torch.save(best_payload, fold_dir / "best_model.pt")
        else:
            epochs_without_improvement += 1

        if args.patience > 0 and epochs_without_improvement >= args.patience:
            break

    if best_payload is None:
        raise RuntimeError(f"Fold {fold_id} did not produce a checkpoint.")

    if args.save_fold_checkpoints:
        fold_dir = output_root / f"repeat_{repeat_id:02d}" / f"fold_{fold_id:02d}"
        fold_dir.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(history).to_csv(fold_dir / "training_history.csv", index=False)
        torch.save(best_payload, fold_dir / "best_model.pt")

    return {
        "repeat": float(repeat_id),
        "fold": float(fold_id),
        **{f"best_{key}": float(value) for key, value in best_payload["metrics"].items() if isinstance(value, (int, float))},
    }


def main() -> None:
    args = parse_args()
    _set_seed(args.seed)
    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        raise SystemExit(f"Manifest not found: {manifest_path}")

    frame = pd.read_csv(manifest_path)
    if frame.empty:
        raise SystemExit("Manifest is empty.")

    output_root = Path(args.checkpoint_root)
    output_root.mkdir(parents=True, exist_ok=True)
    dataset = DyslexiaManifestDataset(manifest_path, DataConfig(text_language=args.text_language))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    fold_rows: list[dict[str, float]] = []
    total_runs = max(1, args.repeats)
    for repeat_id in range(1, total_runs + 1):
        folds = _make_folds(frame, args.task, args.folds, seed=args.seed + repeat_id)
        print(f"\n### Repeat {repeat_id}/{total_runs} ###", flush=True)
        for fold_id, (train_indices, val_indices) in enumerate(folds, start=1):
            print(f"\n=== Repeat {repeat_id} Fold {fold_id}/{len(folds)} ===", flush=True)
            print(f"train_samples={len(train_indices)} validation_samples={len(val_indices)}", flush=True)
            fold_metrics = _train_fold(
                dataset=dataset,
                train_indices=train_indices,
                val_indices=val_indices,
                args=args,
                repeat_id=repeat_id,
                fold_id=fold_id,
                device=device,
                output_root=output_root,
            )
            fold_rows.append(fold_metrics)
            metric_text = " ".join(f"{k}={v:.4f}" for k, v in fold_metrics.items() if k not in {"repeat", "fold"})
            print(f"repeat={repeat_id} fold={fold_id} {metric_text}", flush=True)

    results_frame = pd.DataFrame(fold_rows)
    results_frame.to_csv(output_root / "cross_validation_results.csv", index=False)
    summary: dict[str, object] = {
        "manifest": str(manifest_path),
        "model": args.model,
        "task": args.task,
        "text_language": args.text_language,
        "folds": args.folds,
        "repeats": total_runs,
    }

    metric_columns = [column for column in results_frame.columns if column not in {"repeat", "fold"}]
    for column in metric_columns:
        values = results_frame[column].tolist()
        summary[f"mean_{column}"] = float(statistics.mean(values))
        summary[f"std_{column}"] = float(statistics.pstdev(values)) if len(values) > 1 else 0.0

    (output_root / "cross_validation_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("\nCross-validation summary:")
    for key, value in summary.items():
        if key in {"manifest", "model", "task", "text_language", "folds"}:
            print(f"{key}={value}")
        elif isinstance(value, float):
            print(f"{key}={value:.4f}")


if __name__ == "__main__":
    main()
