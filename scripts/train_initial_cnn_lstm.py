from __future__ import annotations

import argparse
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the initial CNN/LSTM dyslexia screening baseline.")
    parser.add_argument("--manifest", default="data/demo/audio_augmented_manifest.csv")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--checkpoint-dir", default="checkpoints/cnn_lstm")
    parser.add_argument("--text-language", default="bengali", choices=["bengali", "english", "multilingual"])
    args = parser.parse_args()

    command = [
        sys.executable,
        "-m",
        "src.dyslexia_detection.train",
        "--manifest",
        args.manifest,
        "--epochs",
        str(args.epochs),
        "--batch-size",
        str(args.batch_size),
        "--checkpoint-dir",
        args.checkpoint_dir,
        "--model",
        "cnn_lstm",
        "--text-language",
        args.text_language,
    ]
    raise SystemExit(subprocess.call(command))


if __name__ == "__main__":
    main()
