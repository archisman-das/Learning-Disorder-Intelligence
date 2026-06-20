from __future__ import annotations

import argparse
import subprocess
import sys


def train_model(
    model_name: str,
    manifest: str,
    epochs: int,
    batch_size: int,
    text_language: str,
    validation_fraction: float,
    patience: int,
    label_smoothing: float,
    grad_clip_norm: float,
) -> int:
    return subprocess.call(
        [
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
            f"checkpoints/{model_name}",
            "--model",
            model_name,
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
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train initial CNN, LSTM, and CNN/LSTM baselines.")
    parser.add_argument("--manifest", default="data/demo/audio_augmented_manifest.csv")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--text-language", default="bengali", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--label-smoothing", type=float, default=0.05)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    args = parser.parse_args()

    for model_name in ["cnn", "lstm", "cnn_lstm"]:
        print(f"\nTraining {model_name} baseline")
        exit_code = train_model(
            model_name,
            args.manifest,
            args.epochs,
            args.batch_size,
            args.text_language,
            args.validation_fraction,
            args.patience,
            args.label_smoothing,
            args.grad_clip_norm,
        )
        if exit_code != 0:
            raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
