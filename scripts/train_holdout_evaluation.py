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
from sklearn.model_selection import GroupShuffleSplit
from torch import nn
from torch.utils.data import DataLoader, Subset

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.calibration import fit_temperature
from src.dyslexia_detection.config import DataConfig, TrainConfig
from src.dyslexia_detection.cross_lingual import set_trainable_by_prefix, shared_feature_distillation_loss, transfer_matching_weights
from src.dyslexia_detection.dataset import DyslexiaManifestDataset
from src.dyslexia_detection.models import build_model
from src.dyslexia_detection.train import _best_binary_threshold, _class_weights, binary_metrics_at_threshold, build_training_loader, collect_logits_and_labels, evaluate


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
    parser = argparse.ArgumentParser(description="Train with a hard holdout test split for final sanity-check evaluation.")
    parser.add_argument("--manifest", required=True, help="Path to the prepared manifest CSV.")
    parser.add_argument("--model", default="multimodal_attention", choices=SUPPORTED_MODELS)
    parser.add_argument("--task", default="binary", choices=["binary", "severity", "regression"])
    parser.add_argument("--text-language", default="multilingual", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=TrainConfig.learning_rate)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    parser.add_argument("--test-fraction", type=float, default=0.15)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--label-smoothing", type=float, default=0.05)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    parser.add_argument("--checkpoint-dir", default="checkpoints/holdout")
    parser.add_argument("--save-splits", action="store_true")
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


def _group_labels(frame: pd.DataFrame) -> pd.DataFrame:
    grouped = frame.copy()
    grouped["_family_id"] = grouped["sample_id"].map(_sample_family)
    family_frame = grouped.drop_duplicates("_family_id", keep="first")[["_family_id", "label"]].copy()
    family_frame["label"] = pd.to_numeric(family_frame["label"], errors="coerce").fillna(0).astype(int)
    return family_frame


def _split_holdout(frame: pd.DataFrame, validation_fraction: float, test_fraction: float, seed: int) -> tuple[list[int], list[int], list[int]]:
    if validation_fraction <= 0 or test_fraction <= 0:
        raise ValueError("validation_fraction and test_fraction must be positive.")
    if validation_fraction + test_fraction >= 1:
        raise ValueError("validation_fraction + test_fraction must be less than 1.")

    grouped = frame.copy()
    grouped["_family_id"] = grouped["sample_id"].map(_sample_family)
    family_frame = _group_labels(frame)
    if len(family_frame) < 3:
        raise ValueError("Need at least 3 unique families for train/validation/test split.")

    splitter = GroupShuffleSplit(n_splits=1, test_size=test_fraction, random_state=seed)
    trainval_idx, test_idx = next(splitter.split(family_frame, family_frame["label"], groups=family_frame["_family_id"]))
    trainval_families = family_frame.iloc[trainval_idx]["_family_id"].tolist()
    test_families = family_frame.iloc[test_idx]["_family_id"].tolist()

    trainval_frame = family_frame[family_frame["_family_id"].isin(trainval_families)].copy()
    adjusted_validation = validation_fraction / max(1e-8, 1.0 - test_fraction)
    splitter = GroupShuffleSplit(n_splits=1, test_size=adjusted_validation, random_state=seed + 1)
    train_idx, val_idx = next(splitter.split(trainval_frame, trainval_frame["label"], groups=trainval_frame["_family_id"]))
    train_families = trainval_frame.iloc[train_idx]["_family_id"].tolist()
    val_families = trainval_frame.iloc[val_idx]["_family_id"].tolist()

    train_indices = grouped.index[grouped["_family_id"].isin(train_families)].tolist()
    val_indices = grouped.index[grouped["_family_id"].isin(val_families)].tolist()
    test_indices = grouped.index[grouped["_family_id"].isin(test_families)].tolist()
    return train_indices, val_indices, test_indices


def _build_subset(dataset: DyslexiaManifestDataset, indices: list[int]) -> Subset[DyslexiaManifestDataset]:
    return Subset(dataset, indices)


def _build_criterion(task: str, class_weights: torch.Tensor | None, label_smoothing: float) -> nn.Module:
    if task in {"binary", "severity"}:
        return nn.CrossEntropyLoss(weight=class_weights, label_smoothing=max(0.0, min(0.2, label_smoothing)))
    return nn.SmoothL1Loss()


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


def _train_holdout(
    *,
    dataset: DyslexiaManifestDataset,
    train_indices: list[int],
    val_indices: list[int],
    test_indices: list[int],
    args: argparse.Namespace,
    device: torch.device,
) -> dict[str, object]:
    data_config = DataConfig(text_language=args.text_language)
    train_dataset = _build_subset(dataset, train_indices)
    val_dataset = _build_subset(dataset, val_indices)
    test_dataset = _build_subset(dataset, test_indices)

    train_loader = build_training_loader(train_dataset, args.batch_size, args.task)
    val_loader = DataLoader(val_dataset, batch_size=args.batch_size)
    test_loader = DataLoader(test_dataset, batch_size=args.batch_size)

    num_classes = 2 if args.task == "binary" else 3 if args.task == "severity" else 1
    model, teacher_model = _prepare_model(args=args, num_classes=num_classes, device=device)
    train_labels = [int(dataset.frame.iloc[index]["label"]) for index in train_indices]
    class_weights = _class_weights(train_labels, num_classes, device)
    criterion = _build_criterion(args.task, class_weights, args.label_smoothing)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=TrainConfig.weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="max" if args.task != "regression" else "min",
        factor=0.5,
        patience=max(1, args.patience // 2),
        min_lr=max(args.learning_rate * 0.05, 1e-6),
    )

    history: list[dict[str, float]] = []
    best_score = float("-inf")
    best_payload: dict[str, object] | None = None
    epochs_without_improvement = 0

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
        history.append({"epoch": float(epoch), "loss": mean_loss, **{f"val_{key}": float(value) for key, value in metrics.items() if key != "score"}})
        selection_score = metrics["f1"] if args.task == "binary" else metrics["score"]
        scheduler.step(metrics["mae"] if args.task == "regression" else selection_score)

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
                    validation_threshold, threshold_metrics = _best_binary_threshold(torch.softmax(logits, dim=1)[:, 1], labels)
                    best_payload["decision_threshold"] = float(validation_threshold)
                    best_payload["threshold_metrics"] = threshold_metrics
                    best_payload["metrics"] = threshold_metrics
        else:
            epochs_without_improvement += 1

        if args.patience > 0 and epochs_without_improvement >= args.patience:
            break

    if best_payload is None:
        raise RuntimeError("Holdout training did not produce a checkpoint.")

    holdout_metrics = evaluate(
        model,
        test_loader,
        device,
        args.task,
        decision_threshold=float(best_payload.get("decision_threshold", 0.5)),
    )
    model.load_state_dict(best_payload["model_state"])
    logits, labels = collect_logits_and_labels(model, test_loader, device, args.task)
    if args.task != "regression" and logits.numel() > 0:
        holdout_calibration = fit_temperature(logits, labels)
        best_payload["holdout_temperature"] = float(holdout_calibration.temperature)
        best_payload["holdout_calibration_nll"] = float(holdout_calibration.nll)
        if args.task == "binary":
            best_payload["holdout_threshold"] = float(best_payload.get("decision_threshold", 0.5))

    if args.task != "regression":
        if args.task == "binary" and logits.numel() > 0:
            test_threshold = float(best_payload.get("decision_threshold", 0.5))
            predicted = (torch.softmax(logits, dim=1)[:, 1] >= test_threshold).long()
            actual = labels.long()
            holdout_metrics = {
                "accuracy": float(accuracy_score(actual.cpu().numpy(), predicted.cpu().numpy())),
                "precision": float(precision_score(actual.cpu().numpy(), predicted.cpu().numpy(), zero_division=0)),
                "recall": float(recall_score(actual.cpu().numpy(), predicted.cpu().numpy(), zero_division=0)),
                "f1": float(f1_score(actual.cpu().numpy(), predicted.cpu().numpy(), zero_division=0)),
                "balanced_accuracy": float(balanced_accuracy_score(actual.cpu().numpy(), predicted.cpu().numpy())),
                "decision_threshold": float(test_threshold),
                "score": float(f1_score(actual.cpu().numpy(), predicted.cpu().numpy(), zero_division=0)),
            }
        else:
            holdout_metrics = evaluate(model, test_loader, device, args.task)
    else:
        holdout_metrics = evaluate(model, test_loader, device, args.task)

    return {
        "best_validation": best_payload["metrics"],
        "holdout": holdout_metrics,
        "history": history,
        "model_payload": best_payload,
        "train_samples": len(train_indices),
        "validation_samples": len(val_indices),
        "test_samples": len(test_indices),
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

    train_indices, val_indices, test_indices = _split_holdout(frame, args.validation_fraction, args.test_fraction, seed=args.seed)
    if not test_indices:
        raise SystemExit("Could not create a non-empty holdout test split.")

    dataset = DyslexiaManifestDataset(manifest_path, DataConfig(text_language=args.text_language))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    result = _train_holdout(
        dataset=dataset,
        train_indices=train_indices,
        val_indices=val_indices,
        test_indices=test_indices,
        args=args,
        device=device,
    )

    checkpoint_dir = Path(args.checkpoint_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(result["history"]).to_csv(checkpoint_dir / "training_history.csv", index=False)
    payload = dict(result["model_payload"])
    payload["holdout_metrics"] = result["holdout"]
    payload["split_counts"] = {
        "train": int(result["train_samples"]),
        "validation": int(result["validation_samples"]),
        "test": int(result["test_samples"]),
    }
    torch.save(payload, checkpoint_dir / "best_model.pt")
    (checkpoint_dir / "holdout_summary.json").write_text(json.dumps(payload["holdout_metrics"], indent=2), encoding="utf-8")
    if args.save_splits:
        split_dir = checkpoint_dir / "splits"
        split_dir.mkdir(parents=True, exist_ok=True)
        frame.iloc[train_indices].to_csv(split_dir / "train.csv", index=False)
        frame.iloc[val_indices].to_csv(split_dir / "validation.csv", index=False)
        frame.iloc[test_indices].to_csv(split_dir / "test.csv", index=False)

    print("holdout_train_samples=" + str(result["train_samples"]))
    print("holdout_validation_samples=" + str(result["validation_samples"]))
    print("holdout_test_samples=" + str(result["test_samples"]))
    for key, value in result["holdout"].items():
        if isinstance(value, (int, float)):
            print(f"holdout_{key}={float(value):.4f}")


if __name__ == "__main__":
    main()
