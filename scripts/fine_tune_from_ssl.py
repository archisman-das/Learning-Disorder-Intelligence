from __future__ import annotations

import argparse
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune dyslexia models from self-supervised Bengali audio representations.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--ssl-checkpoint", required=True)
    parser.add_argument(
        "--model",
        default="vit_transformer",
        choices=["cnn", "lstm", "cnn_lstm", "transformer", "vit", "vit_transformer", "multimodal", "multimodal_attention"],
    )
    parser.add_argument("--task", default="binary", choices=["binary", "severity", "regression"])
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--text-language", default="bengali", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--checkpoint-dir", default="checkpoints/finetuned_from_ssl")
    args = parser.parse_args()

    command = [
        sys.executable,
        "-m",
        "src.dyslexia_detection.train",
        "--manifest",
        args.manifest,
        "--model",
        args.model,
        "--task",
        args.task,
        "--epochs",
        str(args.epochs),
        "--batch-size",
        str(args.batch_size),
        "--text-language",
        args.text_language,
        "--checkpoint-dir",
        args.checkpoint_dir,
        "--pretrained-audio-encoder",
        args.ssl_checkpoint,
    ]
    raise SystemExit(subprocess.call(command))


if __name__ == "__main__":
    main()
