from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


DEFAULT_MANIFEST = "data/benchmarks/tough_confidence_manifest.csv"
DEFAULT_MODELS = [
    "multimodal_attention",
    "transformer",
    "vit",
    "cnn",
    "lstm",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a longer retrain with the tougher benchmark and weighted priority scoring."
    )
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST)
    parser.add_argument("--task", default="binary", choices=["binary", "severity", "regression"])
    parser.add_argument("--text-language", default="multilingual", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--epochs", type=int, default=24)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=7.5e-4)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--label-smoothing", type=float, default=0.05)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--test-fraction", type=float, default=0.15)
    parser.add_argument("--checkpoint-root", default="checkpoints/selection_holdout_long_retrain")
    parser.add_argument("--best-alias-path", default="checkpoints/best_model_long_retrain.pt")
    parser.add_argument("--pretrained-audio-encoder", default="")
    parser.add_argument("--transfer-checkpoint", default="")
    parser.add_argument("--transfer-prefixes", default="handwriting.,audio.,behavior.,classifier.")
    parser.add_argument("--freeze-transferred-epochs", type=int, default=2)
    parser.add_argument("--distill-checkpoint", default="")
    parser.add_argument("--distill-weight", type=float, default=0.0)
    parser.add_argument("--save-fold-checkpoints", action="store_true")
    parser.add_argument("--save-splits", action="store_true")
    parser.add_argument("--emit-json-line", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Print the underlying command without running it.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        raise SystemExit(f"Manifest not found: {manifest_path}")

    command = [
        sys.executable,
        str(Path(__file__).resolve().parent / "select_model_via_cv_and_holdout.py"),
        "--manifest",
        str(manifest_path),
        "--task",
        args.task,
        "--text-language",
        args.text_language,
        "--models",
        *args.models,
        "--folds",
        str(args.folds),
        "--repeats",
        str(args.repeats),
        "--epochs",
        str(args.epochs),
        "--batch-size",
        str(args.batch_size),
        "--learning-rate",
        str(args.learning_rate),
        "--patience",
        str(args.patience),
        "--label-smoothing",
        str(args.label_smoothing),
        "--grad-clip-norm",
        str(args.grad_clip_norm),
        "--validation-fraction",
        str(args.validation_fraction),
        "--test-fraction",
        str(args.test_fraction),
        "--checkpoint-root",
        str(Path(args.checkpoint_root)),
        "--selection-metric",
        "weighted_priority_score",
        "--best-alias-path",
        str(Path(args.best_alias_path)),
        "--freeze-transferred-epochs",
        str(args.freeze_transferred_epochs),
    ]

    if args.save_fold_checkpoints:
        command.append("--save-fold-checkpoints")
    if args.save_splits:
        command.append("--save-splits")
    if args.pretrained_audio_encoder:
        command.extend(["--pretrained-audio-encoder", args.pretrained_audio_encoder])
    if args.transfer_checkpoint:
        command.extend(["--transfer-checkpoint", args.transfer_checkpoint])
    if args.transfer_prefixes:
        command.extend(["--transfer-prefixes", args.transfer_prefixes])
    if args.distill_checkpoint:
        command.extend(["--distill-checkpoint", args.distill_checkpoint])
    if args.distill_weight > 0:
        command.extend(["--distill-weight", str(args.distill_weight)])
    if args.emit_json_line:
        command.append("--emit-json-line")
    if args.quiet:
        command.append("--quiet")

    print("Long retrain command:")
    print(" ".join(command))
    if args.dry_run:
        return

    completed = subprocess.run(command, check=False)
    raise SystemExit(completed.returncode)


if __name__ == "__main__":
    main()
