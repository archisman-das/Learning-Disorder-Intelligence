from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import torch
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error
from torch import nn
from torch.utils.data import DataLoader, random_split

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
        choices=["cnn", "lstm", "cnn_lstm", "transformer", "vit", "vit_transformer", "multimodal", "multimodal_attention"],
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
    return parser.parse_args()


def evaluate(model: nn.Module, loader: DataLoader, device: torch.device, task: str) -> dict[str, float]:
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
    target_key = "label" if task == "binary" else "severity_label"
    with torch.no_grad():
        for batch in loader:
            batch = {key: value.to(device) for key, value in batch.items()}
            logits = model(batch["image"], batch["audio"], batch["text"], batch["errors"], batch["behavior"])
            predictions.extend(logits.argmax(dim=1).cpu().tolist())
            labels.extend(batch[target_key].cpu().tolist())

    averaging = "binary" if task == "binary" else "macro"
    return {
        "accuracy": float(accuracy_score(labels, predictions)),
        "f1": float(f1_score(labels, predictions, average=averaging, zero_division=0)),
        "score": float(f1_score(labels, predictions, average=averaging, zero_division=0)),
    }


def main() -> None:
    args = parse_args()
    data_config = DataConfig(text_language=args.text_language)
    dataset = DyslexiaManifestDataset(args.manifest, data_config)

    validation_size = max(1, int(len(dataset) * 0.2))
    train_size = len(dataset) - validation_size
    train_dataset, validation_dataset = random_split(
        dataset,
        [train_size, validation_size],
        generator=torch.Generator().manual_seed(42),
    )

    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True)
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
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=args.learning_rate,
        weight_decay=TrainConfig.weight_decay,
    )
    criterion = nn.CrossEntropyLoss() if args.task in {"binary", "severity"} else nn.MSELoss()

    checkpoint_dir = Path(args.checkpoint_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    best_score = float("-inf")
    history: list[dict[str, float]] = []

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
            optimizer.step()
            total_loss += float(loss.item())

        metrics = evaluate(model, validation_loader, device, args.task)
        mean_loss = total_loss / max(1, len(train_loader))
        if args.task == "regression":
            print(f"epoch={epoch} loss={mean_loss:.4f} val_mae={metrics['mae']:.4f}")
            history.append({"epoch": float(epoch), "loss": mean_loss, "val_mae": metrics["mae"]})
        else:
            print(
                f"epoch={epoch} loss={mean_loss:.4f} "
                f"val_accuracy={metrics['accuracy']:.4f} val_f1={metrics['f1']:.4f}"
            )
            history.append(
                {
                    "epoch": float(epoch),
                    "loss": mean_loss,
                    "val_accuracy": metrics["accuracy"],
                    "val_f1": metrics["f1"],
                }
            )
        pd.DataFrame(history).to_csv(checkpoint_dir / "training_history.csv", index=False)

        if metrics["score"] > best_score:
            best_score = metrics["score"]
            torch.save(
                {
                    "model_name": args.model,
                    "task": args.task,
                    "num_classes": num_classes,
                    "model_state": model.state_dict(),
                    "data_config": data_config.__dict__,
                    "metrics": metrics,
                },
                checkpoint_dir / "best_model.pt",
            )


if __name__ == "__main__":
    main()
