from __future__ import annotations

import argparse
import subprocess
import sys


def run_training(model_name: str, manifest: str, task: str, epochs: int, batch_size: int, text_language: str) -> int:
    return subprocess.call(
        [
            sys.executable,
            "-m",
            "src.dyslexia_detection.train",
            "--manifest",
            manifest,
            "--model",
            model_name,
            "--task",
            task,
            "--epochs",
            str(epochs),
            "--batch-size",
            str(batch_size),
            "--text-language",
            text_language,
            "--checkpoint-dir",
            f"checkpoints/{task}_{model_name}",
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train dyslexia severity prediction models.")
    parser.add_argument("--manifest", default="data/demo/audio_augmented_manifest.csv")
    parser.add_argument(
        "--model",
        default="vit_transformer",
        choices=["cnn_lstm", "transformer", "vit", "vit_transformer", "multimodal", "multimodal_attention"],
    )
    parser.add_argument("--task", default="severity", choices=["severity", "regression"])
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--text-language", default="multilingual", choices=["bengali", "english", "multilingual"])
    args = parser.parse_args()

    raise SystemExit(
        run_training(
            model_name=args.model,
            manifest=args.manifest,
            task=args.task,
            epochs=args.epochs,
            batch_size=args.batch_size,
            text_language=args.text_language,
        )
    )


if __name__ == "__main__":
    main()
