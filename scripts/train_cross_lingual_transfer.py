from __future__ import annotations

import argparse
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Cross-lingual transfer learning: English checkpoint to Bengali fine-tuning.")
    parser.add_argument("--manifest", required=True, help="Target-language manifest (for example Bengali).")
    parser.add_argument("--english-checkpoint", required=True, help="Source checkpoint trained on English data.")
    parser.add_argument(
        "--model",
        default="vit_transformer",
        choices=["cnn", "lstm", "cnn_lstm", "transformer", "vit", "vit_transformer", "multimodal", "multimodal_attention"],
    )
    parser.add_argument("--task", default="severity", choices=["binary", "severity", "regression"])
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--text-language", default="bengali", choices=["bengali", "hindi", "english", "multilingual"])
    parser.add_argument("--checkpoint-dir", default="checkpoints/cross_lingual_transfer")
    parser.add_argument(
        "--transfer-prefixes",
        default="handwriting.,audio.,behavior.,classifier.",
        help="Comma-separated prefixes of modules to transfer.",
    )
    parser.add_argument("--freeze-transferred-epochs", type=int, default=1)
    parser.add_argument("--distill-weight", type=float, default=0.1)
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
        "--learning-rate",
        str(args.learning_rate),
        "--text-language",
        args.text_language,
        "--checkpoint-dir",
        args.checkpoint_dir,
        "--transfer-checkpoint",
        args.english_checkpoint,
        "--transfer-prefixes",
        args.transfer_prefixes,
        "--freeze-transferred-epochs",
        str(args.freeze_transferred_epochs),
        "--distill-checkpoint",
        args.english_checkpoint,
        "--distill-weight",
        str(args.distill_weight),
    ]
    raise SystemExit(subprocess.call(command))


if __name__ == "__main__":
    main()
