from __future__ import annotations

import argparse
import subprocess
import sys


def train_model(model_name: str, manifest: str, epochs: int, batch_size: int, text_language: str) -> int:
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
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Transformer, ViT, and ViT+Transformer multimodal models.")
    parser.add_argument("--manifest", default="data/demo/audio_augmented_manifest.csv")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--text-language", default="bengali", choices=["bengali", "hindi", "english", "multilingual"])
    parser.add_argument(
        "--models",
        nargs="+",
        default=["transformer", "vit", "vit_transformer", "multimodal_attention"],
        choices=["transformer", "vit", "vit_transformer", "multimodal_attention"],
    )
    args = parser.parse_args()

    for model_name in args.models:
        print(f"\nTraining {model_name} model", flush=True)
        exit_code = train_model(model_name, args.manifest, args.epochs, args.batch_size, args.text_language)
        if exit_code != 0:
            raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
