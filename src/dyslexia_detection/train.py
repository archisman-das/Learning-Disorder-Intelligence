from __future__ import annotations

import argparse
import re
from pathlib import Path

import pandas as pd
import torch
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, mean_absolute_error, precision_score, recall_score
from sklearn.model_selection import train_test_split
from torch import nn
from torch.utils.data import DataLoader, Subset, WeightedRandomSampler

from .calibration import fit_temperature
from .config import DataConfig, TrainConfig
from .cross_lingual import set_trainable_by_prefix, shared_feature_distillation_loss, transfer_matching_weights
from .dataset import DyslexiaManifestDataset
from .models import build_model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the multimodal dyslexia screening model.")
    parser.add_argument("--manifest", required=True, help="Path to dataset CSV manifest.")
    parser.add_argument("--epochs", type=int, default=TrainConfig.epochs)
    parser.add_argument("--batch-size", type=int, default=TrainConfig.batch_size)
    parser.add_argument("--learning-rate", type=float, default=TrainConfig.learning_rate)
    parser.add_argument("--checkpoint-dir", default=str(TrainConfig.checkpoint_dir))
    parser.add_argument(
        "--text-language",
        default="bengali",
        choices=["bengali", "english", "multilingual"],
        help="Text vocabulary used by the model. Use multilingual for mixed-language manifests.",
    )
    parser.add_argument(
        "--model",
        choices=["cnn_lstm", "transformer", "vit", "vit_transformer", "multimodal", "multimodal_attention"],
        default="multimodal",
        help="Model architecture to train.",
    )
    parser.add_argument(
        "--task",
        choices=["binary", "severity", "regression"],
        default="binary",
        help="Training target: binary risk, 3-level severity, or continuous severity regression.",
    )
    parser.add_argument(
        "--pretrained-audio-encoder",
        default="",
        help="Optional SSL audio encoder checkpoint to initialize the model audio branch.",
    )
    parser.add_argument(
        "--transfer-checkpoint",
        default="",
        help="Optional source-language checkpoint (for example English) for cross-lingual weight transfer.",
    )
    parser.add_argument(
        "--transfer-prefixes",
        default="handwriting.,audio.,behavior.,classifier.",
        help="Comma-separated module prefixes to transfer from source checkpoint.",
    )
    parser.add_argument(
        "--freeze-transferred-epochs",
        type=int,
        default=0,
        help="Freeze transferred branches for N warm-start epochs.",
    )
    parser.add_argument(
        "--distill-checkpoint",
        default="",
        help="Optional source-language checkpoint for feature-level distillation during Bengali fine-tuning.",
    )
    parser.add_argument(
        "--distill-weight",
        type=float,
        default=0.0,
        help="Weight for shared-modality distillation loss (0 disables distillation).",
    )
    parser.add_argument(
        "--validation-fraction",
        type=float,
        default=0.2,
        help="Fraction of unique sample families reserved for validation.",
    )
    parser.add_argument(
        "--patience",
        type=int,
        default=5,
        help="Early-stopping patience measured in validation epochs.",
    )
    parser.add_argument(
        "--label-smoothing",
        type=float,
        default=0.05,
        help="Label smoothing applied to classification losses.",
    )
    parser.add_argument(
        "--grad-clip-norm",
        type=float,
        default=1.0,
        help="Gradient clipping threshold.",
    )
    return parser.parse_args()


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


def _split_family_indices(frame: pd.DataFrame, validation_fraction: float, seed: int) -> tuple[list[int], list[int]]:
    if frame.empty:
        return [], []

    grouped = frame.copy()
    grouped["_family_id"] = grouped["sample_id"].map(_sample_family)
    family_frame = grouped.drop_duplicates("_family_id", keep="first")[["_family_id", "label"]].copy()
    family_frame["label"] = family_frame["label"].astype(int)

    if len(family_frame) < 2:
        indices = list(grouped.index)
        return indices, []

    test_size = min(max(validation_fraction, 0.05), 0.5)
    family_labels = family_frame["label"]
    can_stratify = family_labels.nunique() > 1 and family_labels.value_counts().min() >= 2 and len(family_frame) > 3

    try:
        train_families, validation_families = train_test_split(
            family_frame["_family_id"].tolist(),
            test_size=test_size,
            random_state=seed,
            stratify=family_labels.tolist() if can_stratify else None,
        )
    except ValueError:
        shuffled = family_frame.sample(frac=1.0, random_state=seed)
        boundary = max(1, int(round(len(shuffled) * (1.0 - test_size))))
        train_families = shuffled["_family_id"].iloc[:boundary].tolist()
        validation_families = shuffled["_family_id"].iloc[boundary:].tolist()

    train_indices = grouped.index[grouped["_family_id"].isin(train_families)].tolist()
    validation_indices = grouped.index[grouped["_family_id"].isin(validation_families)].tolist()
    if not validation_indices and train_indices:
        validation_indices = train_indices[-1:]
        train_indices = train_indices[:-1]
    return train_indices, validation_indices


def _build_subset(dataset: DyslexiaManifestDataset, indices: list[int]) -> Subset[DyslexiaManifestDataset]:
    return Subset(dataset, indices)


def _class_weights(labels: list[int], num_classes: int, device: torch.device) -> torch.Tensor | None:
    if num_classes <= 1 or not labels:
        return None
    counts = torch.bincount(torch.tensor(labels, dtype=torch.long), minlength=num_classes).float()
    if (counts <= 0).any():
        counts = counts.clamp_min(1.0)
    weights = counts.sum() / (counts * float(num_classes))
    return weights.to(device)


def build_training_loader(dataset: Subset[DyslexiaManifestDataset], batch_size: int, task: str) -> DataLoader:
    labels = _training_samples(dataset)
    if task == "regression" or not labels:
        return DataLoader(dataset, batch_size=batch_size, shuffle=True)

    label_tensor = torch.tensor(labels, dtype=torch.long)
    counts = torch.bincount(label_tensor, minlength=int(label_tensor.max().item()) + 1).float().clamp_min(1.0)
    sample_weights = (1.0 / counts)[label_tensor]
    sampler = WeightedRandomSampler(sample_weights.double(), num_samples=len(sample_weights), replacement=True)
    return DataLoader(dataset, batch_size=batch_size, sampler=sampler)


def _binary_threshold(logits: torch.Tensor, threshold: float) -> torch.Tensor:
    probabilities = torch.softmax(logits, dim=1)[:, 1]
    return (probabilities >= threshold).long()


def binary_metrics_at_threshold(probabilities: torch.Tensor, labels: torch.Tensor, threshold: float) -> dict[str, float]:
    labels_np = labels.cpu().numpy()
    probabilities_np = probabilities.cpu().numpy()
    predictions = (probabilities_np >= threshold).astype(int)
    precision = precision_score(labels_np, predictions, zero_division=0)
    recall = recall_score(labels_np, predictions, zero_division=0)
    f1 = f1_score(labels_np, predictions, zero_division=0)
    accuracy = accuracy_score(labels_np, predictions)
    balanced = balanced_accuracy_score(labels_np, predictions)
    return {
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "balanced_accuracy": float(balanced),
        "decision_threshold": float(threshold),
    }


def _best_binary_threshold(probabilities: torch.Tensor, labels: torch.Tensor) -> tuple[float, dict[str, float]]:
    best_threshold = 0.5
    best_score = float("-inf")
    best_metrics = {
        "accuracy": 0.0,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
        "balanced_accuracy": 0.0,
        "decision_threshold": float(best_threshold),
    }
    if probabilities.numel() == 0 or labels.numel() == 0:
        return best_threshold, best_metrics

    thresholds = torch.linspace(0.25, 0.95, steps=29).tolist()
    labels_np = labels.cpu().numpy()
    probabilities_np = probabilities.cpu().numpy()
    for threshold in thresholds:
        predictions = (probabilities_np >= threshold).astype(int)
        precision = precision_score(labels_np, predictions, zero_division=0)
        recall = recall_score(labels_np, predictions, zero_division=0)
        f1 = f1_score(labels_np, predictions, zero_division=0)
        accuracy = accuracy_score(labels_np, predictions)
        balanced = balanced_accuracy_score(labels_np, predictions)
        score = (accuracy * 0.55) + (precision * 0.35) + (balanced * 0.10)
        if score > best_score or (score == best_score and (accuracy > best_metrics["accuracy"] or precision > best_metrics["precision"])):
            best_score = score
            best_threshold = float(threshold)
            best_metrics = {
                "accuracy": float(accuracy),
                "precision": float(precision),
                "recall": float(recall),
                "f1": float(f1),
                "balanced_accuracy": float(balanced),
                "decision_threshold": float(threshold),
            }
    return best_threshold, best_metrics


def split_binary_calibration_evaluation(
    probabilities: torch.Tensor,
    labels: torch.Tensor,
    *,
    calibration_fraction: float = 0.6,
    seed: int = 42,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    if probabilities.numel() == 0 or labels.numel() == 0:
        return probabilities, labels, probabilities, labels

    if probabilities.shape[0] != labels.shape[0]:
        raise ValueError("probabilities and labels must have the same length.")

    indices = list(range(int(labels.shape[0])))
    label_list = labels.cpu().tolist()
    can_stratify = len(set(label_list)) > 1 and min(label_list.count(label) for label in set(label_list)) >= 2
    test_size = max(0.1, min(0.9, 1.0 - float(calibration_fraction)))

    try:
        calibration_indices, evaluation_indices = train_test_split(
            indices,
            test_size=test_size,
            random_state=seed,
            stratify=label_list if can_stratify else None,
        )
    except ValueError:
        shuffled = torch.randperm(len(indices), generator=torch.Generator().manual_seed(seed)).tolist()
        boundary = max(1, int(round(len(shuffled) * float(calibration_fraction))))
        calibration_indices = shuffled[:boundary]
        evaluation_indices = shuffled[boundary:]

    if not evaluation_indices:
        evaluation_indices = calibration_indices

    calibration = torch.tensor(calibration_indices, dtype=torch.long)
    evaluation = torch.tensor(evaluation_indices, dtype=torch.long)
    return (
        probabilities.index_select(0, calibration),
        labels.index_select(0, calibration),
        probabilities.index_select(0, evaluation),
        labels.index_select(0, evaluation),
    )


def evaluate(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    task: str,
    *,
    decision_threshold: float = 0.5,
) -> dict[str, float]:
    model.eval()
    if task == "regression":
        targets: list[float] = []
        predictions: list[float] = []
        with torch.no_grad():
            for batch in loader:
                batch = {key: value.to(device) for key, value in batch.items()}
                logits = model(batch["image"], batch["audio"], batch["text"], batch["errors"], batch["behavior"]).squeeze(1)
                predictions.extend(logits.cpu().tolist())
                targets.extend(batch["severity_score"].cpu().tolist())
        mae = mean_absolute_error(targets, predictions)
        return {
            "mae": float(mae),
            "score": float(-mae),
        }

    labels: list[int] = []
    predictions: list[int] = []
    probabilities: list[float] = []
    target_key = "label" if task == "binary" else "severity_label"
    with torch.no_grad():
        for batch in loader:
            batch = {key: value.to(device) for key, value in batch.items()}
            logits = model(batch["image"], batch["audio"], batch["text"], batch["errors"], batch["behavior"])
            if task == "binary":
                probabilities.extend(torch.softmax(logits, dim=1)[:, 1].cpu().tolist())
                predictions.extend(_binary_threshold(logits, decision_threshold).cpu().tolist())
            else:
                predictions.extend(logits.argmax(dim=1).cpu().tolist())
            labels.extend(batch[target_key].cpu().tolist())

    averaging = "binary" if task == "binary" else "macro"
    precision = precision_score(labels, predictions, average=averaging, zero_division=0)
    recall = recall_score(labels, predictions, average=averaging, zero_division=0)
    f1 = f1_score(labels, predictions, average=averaging, zero_division=0)
    accuracy = accuracy_score(labels, predictions)
    balanced = balanced_accuracy_score(labels, predictions) if task == "binary" else None
    metrics = {
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "score": float(f1 if task != "binary" else (accuracy * 0.45) + (f1 * 0.35) + (float(balanced) * 0.20 if balanced is not None else 0.0)),
    }
    if task == "binary":
        metrics["balanced_accuracy"] = float(balanced if balanced is not None else balanced_accuracy_score(labels, predictions))
        metrics["decision_threshold"] = float(decision_threshold)
    return metrics


def collect_logits_and_labels(model: nn.Module, loader: DataLoader, device: torch.device, task: str) -> tuple[torch.Tensor, torch.Tensor]:
    logits_list: list[torch.Tensor] = []
    label_list: list[torch.Tensor] = []
    target_key = "label" if task == "binary" else "severity_label"
    with torch.no_grad():
        for batch in loader:
            batch = {key: value.to(device) for key, value in batch.items()}
            logits = model(batch["image"], batch["audio"], batch["text"], batch["errors"], batch["behavior"])
            logits_list.append(logits.detach().cpu())
            label_list.append(batch[target_key].detach().cpu())
    if not logits_list:
        return torch.empty(0), torch.empty(0, dtype=torch.long)
    return torch.cat(logits_list, dim=0), torch.cat(label_list, dim=0)


def _training_samples(dataset: Subset[DyslexiaManifestDataset]) -> list[int]:
    labels: list[int] = []
    for index in dataset.indices:
        labels.append(int(dataset.dataset.frame.iloc[index]["label"]))
    return labels


def main() -> None:
    args = parse_args()
    data_config = DataConfig(text_language=args.text_language)
    dataset = DyslexiaManifestDataset(args.manifest, data_config)
    train_indices, validation_indices = _split_family_indices(dataset.frame, args.validation_fraction, 42)
    if not validation_indices:
        raise ValueError("Unable to create a validation split from the manifest.")

    train_dataset = _build_subset(dataset, train_indices)
    validation_dataset = _build_subset(dataset, validation_indices)

    train_loader = build_training_loader(train_dataset, args.batch_size, args.task)
    validation_loader = DataLoader(validation_dataset, batch_size=args.batch_size)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    num_classes = 2 if args.task == "binary" else 3 if args.task == "severity" else 1
    model = build_model(args.model, data_config, num_classes=num_classes).to(device)
    transferred_prefixes = tuple(prefix.strip() for prefix in args.transfer_prefixes.split(",") if prefix.strip())
    if args.transfer_checkpoint:
        source_payload = torch.load(args.transfer_checkpoint, map_location="cpu")
        report = transfer_matching_weights(
            model,
            source_payload["model_state"],
            include_prefixes=transferred_prefixes,
        )
        print(
            f"cross_lingual_transfer checkpoint={args.transfer_checkpoint} "
            f"copied_tensors={report.copied_tensors} skipped_tensors={report.skipped_tensors} copied_parameters={report.copied_parameters}"
        )
    if args.pretrained_audio_encoder:
        if not hasattr(model, "audio"):
            raise ValueError(f"Model '{args.model}' does not expose an audio encoder for SSL initialization.")
        ssl_payload = torch.load(args.pretrained_audio_encoder, map_location="cpu")
        encoder_state = ssl_payload.get("audio_encoder_state")
        if encoder_state is None:
            raise ValueError(f"Invalid SSL checkpoint (missing audio_encoder_state): {args.pretrained_audio_encoder}")
        model.audio.load_state_dict(encoder_state, strict=True)
        print(f"initialized_audio_encoder_from={args.pretrained_audio_encoder}")

    teacher_model: nn.Module | None = None
    if args.distill_checkpoint and args.distill_weight > 0:
        teacher_payload = torch.load(args.distill_checkpoint, map_location="cpu")
        teacher_config = teacher_payload.get("data_config", DataConfig())
        if isinstance(teacher_config, dict):
            teacher_config = DataConfig(**teacher_config)
        teacher_num_classes = int(teacher_payload.get("num_classes", num_classes))
        teacher_model = build_model(
            teacher_payload.get("model_name", args.model),
            teacher_config,
            num_classes=teacher_num_classes,
        ).to(device)
        teacher_report = transfer_matching_weights(
            teacher_model,
            teacher_payload["model_state"],
            include_prefixes=("handwriting.", "audio.", "behavior."),
        )
        teacher_model.eval()
        print(
            f"distillation_teacher={args.distill_checkpoint} distill_weight={args.distill_weight} "
            f"teacher_copied_tensors={teacher_report.copied_tensors}"
        )

    train_labels = _training_samples(train_dataset)
    class_weights = _class_weights(train_labels, num_classes, device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=args.learning_rate,
        weight_decay=TrainConfig.weight_decay,
    )
    if args.task in {"binary", "severity"}:
        criterion = nn.CrossEntropyLoss(weight=class_weights, label_smoothing=max(0.0, min(0.2, args.label_smoothing)))
    else:
        criterion = nn.SmoothL1Loss()
    scheduler = (
        torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer,
            mode="max" if args.task != "regression" else "min",
            factor=0.5,
            patience=max(1, args.patience // 2),
            min_lr=max(args.learning_rate * 0.05, 1e-6),
        )
        if args.task != "regression"
        else torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer,
            mode="min",
            factor=0.5,
            patience=max(1, args.patience // 2),
            min_lr=max(args.learning_rate * 0.05, 1e-6),
        )
    )

    checkpoint_dir = Path(args.checkpoint_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    best_score = float("-inf")
    best_epoch = 0
    epochs_without_improvement = 0
    history: list[dict[str, float]] = []
    best_decision_threshold = 0.5

    for epoch in range(1, args.epochs + 1):
        if args.freeze_transferred_epochs > 0:
            if epoch <= args.freeze_transferred_epochs:
                trainable = ("text.", "classifier.")
                set_trainable_by_prefix(model, trainable)
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
                target = batch["label"]
                loss = criterion(logits, target)
            elif args.task == "severity":
                target = batch["severity_label"]
                loss = criterion(logits, target)
            else:
                target = batch["severity_score"]
                loss = criterion(logits.squeeze(1), target)
            if teacher_model is not None and args.distill_weight > 0:
                distill = shared_feature_distillation_loss(
                    model,
                    teacher_model,
                    batch["image"],
                    batch["audio"],
                    batch["behavior"],
                )
                loss = loss + (args.distill_weight * distill)
            loss.backward()
            if args.grad_clip_norm > 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=args.grad_clip_norm)
            optimizer.step()
            total_loss += float(loss.item())

        metrics = evaluate(model, validation_loader, device, args.task)
        mean_loss = total_loss / max(1, len(train_loader))
        if args.task == "regression":
            print(f"epoch={epoch} loss={mean_loss:.4f} val_mae={metrics['mae']:.4f}")
            history.append({"epoch": float(epoch), "loss": mean_loss, "val_mae": metrics["mae"]})
            scheduler.step(metrics["mae"])
        else:
            print(
                f"epoch={epoch} loss={mean_loss:.4f} "
                f"val_accuracy={metrics['accuracy']:.4f} val_precision={metrics['precision']:.4f} val_f1={metrics['f1']:.4f}"
            )
            history.append(
                {
                    "epoch": float(epoch),
                    "loss": mean_loss,
                    "val_accuracy": metrics["accuracy"],
                    "val_precision": metrics["precision"],
                    "val_recall": metrics["recall"],
                    "val_f1": metrics["f1"],
                }
            )
            scheduler.step(metrics["score"])
        pd.DataFrame(history).to_csv(checkpoint_dir / "training_history.csv", index=False)

        if metrics["score"] > best_score:
            best_score = metrics["score"]
            best_epoch = epoch
            epochs_without_improvement = 0
            best_decision_threshold = float(metrics.get("decision_threshold", 0.5))
            torch.save(
                {
                    "model_name": args.model,
                    "task": args.task,
                    "num_classes": num_classes,
                    "model_state": model.state_dict(),
                    "data_config": data_config.__dict__,
                    "metrics": metrics,
                    "decision_threshold": best_decision_threshold,
                },
                checkpoint_dir / "best_model.pt",
            )
        else:
            epochs_without_improvement += 1

        if args.patience > 0 and epochs_without_improvement >= args.patience:
            print(f"early_stopping=epoch_{epoch} best_epoch={best_epoch} best_score={best_score:.4f}")
            break

    if args.task != "regression" and (checkpoint_dir / "best_model.pt").exists():
        best_payload = torch.load(checkpoint_dir / "best_model.pt", map_location=device)
        model.load_state_dict(best_payload["model_state"])
        logits, labels = collect_logits_and_labels(model, validation_loader, device, args.task)
        calibration = fit_temperature(logits, labels)
        probabilities = torch.softmax(logits, dim=1)
        if args.task == "binary" and probabilities.numel() > 0:
            validation_threshold, threshold_metrics = _best_binary_threshold(probabilities[:, 1], labels)
            best_payload["decision_threshold"] = float(validation_threshold)
            best_payload["threshold_metrics"] = threshold_metrics
            print(
                f"validation_threshold={validation_threshold:.3f} "
                f"threshold_precision={threshold_metrics['precision']:.4f} "
                f"threshold_f1={threshold_metrics['f1']:.4f}"
            )
        best_payload["temperature"] = float(calibration.temperature)
        best_payload["calibration_nll"] = float(calibration.nll)
        torch.save(best_payload, checkpoint_dir / "best_model.pt")
        print(f"calibration_temperature={calibration.temperature:.3f} calibration_nll={calibration.nll:.4f}")


if __name__ == "__main__":
    main()
