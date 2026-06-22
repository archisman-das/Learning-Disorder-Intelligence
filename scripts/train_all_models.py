from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


SUPPORTED_MODELS = [
    "cnn_lstm",
    "transformer",
    "vit",
    "vit_transformer",
    "multimodal",
    "multimodal_attention",
]


def train_model(
    model_name: str,
    manifest: str,
    epochs: int,
    batch_size: int,
    text_language: str,
    task: str,
    checkpoint_root: Path,
    validation_fraction: float = 0.2,
    patience: int = 5,
    label_smoothing: float = 0.05,
    grad_clip_norm: float = 1.0,
    pretrained_audio_encoder: str = "",
    transfer_checkpoint: str = "",
    transfer_prefixes: str = "handwriting.,audio.,behavior.,classifier.",
    freeze_transferred_epochs: int = 0,
    distill_checkpoint: str = "",
    distill_weight: float = 0.0,
) -> int:
    checkpoint_dir = checkpoint_root / f"{task}_{model_name}"
    command = [
        sys.executable,
        "-m",
        "src.dyslexia_detection.train",
        "--manifest",
        manifest,
        "--epochs",
        str(epochs),
        "--batch-size",
        str(batch_size),
        "--checkpoint-dir",
        str(checkpoint_dir),
        "--model",
        model_name,
        "--task",
        task,
        "--text-language",
        text_language,
        "--validation-fraction",
        str(validation_fraction),
        "--patience",
        str(patience),
        "--label-smoothing",
        str(label_smoothing),
        "--grad-clip-norm",
        str(grad_clip_norm),
    ]

    if pretrained_audio_encoder:
        command.extend(["--pretrained-audio-encoder", pretrained_audio_encoder])
    if transfer_checkpoint:
        command.extend(["--transfer-checkpoint", transfer_checkpoint])
        command.extend(["--transfer-prefixes", transfer_prefixes])
        if freeze_transferred_epochs > 0:
            command.extend(["--freeze-transferred-epochs", str(freeze_transferred_epochs)])
    if distill_checkpoint and distill_weight > 0:
        command.extend(["--distill-checkpoint", distill_checkpoint])
        command.extend(["--distill-weight", str(distill_weight)])

    return subprocess.call(command)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train all supported dyslexia models sequentially.")
    parser.add_argument("--manifest", default="data/demo/audio_augmented_manifest.csv")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--text-language", default="multilingual", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--task", default="binary", choices=["binary", "severity", "regression"])
    parser.add_argument("--checkpoint-root", default="checkpoints")
    parser.add_argument("--models", nargs="+", default=SUPPORTED_MODELS, choices=SUPPORTED_MODELS)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--label-smoothing", type=float, default=0.05)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    parser.add_argument("--pretrained-audio-encoder", default="")
    parser.add_argument("--transfer-checkpoint", default="")
    parser.add_argument("--transfer-prefixes", default="handwriting.,audio.,behavior.,classifier.")
    parser.add_argument("--freeze-transferred-epochs", type=int, default=0)
    parser.add_argument("--distill-checkpoint", default="")
    parser.add_argument("--distill-weight", type=float, default=0.0)
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        raise SystemExit(f"Manifest not found: {manifest_path}")

    checkpoint_root = Path(args.checkpoint_root)
    checkpoint_root.mkdir(parents=True, exist_ok=True)

    print(
        "Training all supported models against "
        f"{manifest_path} ({args.task}, {args.text_language})",
        flush=True,
    )

    for model_name in args.models:
        print(f"\n=== Training {model_name} ===", flush=True)
        exit_code = train_model(
            model_name=model_name,
            manifest=str(manifest_path),
            epochs=args.epochs,
            batch_size=args.batch_size,
            text_language=args.text_language,
            task=args.task,
            checkpoint_root=checkpoint_root,
            validation_fraction=args.validation_fraction,
            patience=args.patience,
            label_smoothing=args.label_smoothing,
            grad_clip_norm=args.grad_clip_norm,
            pretrained_audio_encoder=args.pretrained_audio_encoder,
            transfer_checkpoint=args.transfer_checkpoint,
            transfer_prefixes=args.transfer_prefixes,
            freeze_transferred_epochs=args.freeze_transferred_epochs,
            distill_checkpoint=args.distill_checkpoint,
            distill_weight=args.distill_weight,
        )
        if exit_code != 0:
            raise SystemExit(exit_code)

    print("\nAll requested model trainings completed.", flush=True)


if __name__ == "__main__":
    main()
