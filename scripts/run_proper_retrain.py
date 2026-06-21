from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


DEFAULT_SPLIT_DIR = "data/benchmarks/hard_family_split_balanced_harder"
DEFAULT_MODELS = [
  "multimodal_attention",
  "transformer",
  "vit",
  "cnn",
  "lstm",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the stricter hard-split retrain with conservative settings."
    )
    parser.add_argument("--split-dir", default=DEFAULT_SPLIT_DIR)
    parser.add_argument("--checkpoint-root", default="checkpoints/hard_split_selection_balanced_harder_run_proper")
    parser.add_argument("--best-alias-path", default="checkpoints/best_model_long_retrain.pt")
    parser.add_argument("--final-threshold-mode", default="default", choices=["default", "tuned"])
    parser.add_argument("--seeds", nargs="+", type=int, default=[21])
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--task", default="binary", choices=["binary", "severity", "regression"])
    parser.add_argument("--text-language", default="multilingual", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--patience", type=int, default=4)
    parser.add_argument("--selection-metric", default="score")
    parser.add_argument("--label-smoothing", type=float, default=0.1)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    parser.add_argument("--learning-rate", type=float, default=5e-4)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    split_dir = Path(args.split_dir)
    for filename in ("train.csv", "validation.csv", "final_eval.csv"):
        if not (split_dir / filename).exists():
            raise SystemExit(f"Manifest not found: {split_dir / filename}")

    command = [
        sys.executable,
        str(Path(__file__).resolve().parent / "run_strict_benchmark.py"),
        "--split-dir",
        str(split_dir),
        "--checkpoint-root",
        str(Path(args.checkpoint_root)),
        "--best-alias-path",
        str(Path(args.best_alias_path)),
        "--final-threshold-mode",
        args.final_threshold_mode,
        "--seeds",
        *[str(seed) for seed in args.seeds],
        "--",
        "--models",
        *args.models,
        "--task",
        args.task,
        "--text-language",
        args.text_language,
        "--selection-metric",
        args.selection_metric,
        "--epochs",
        str(args.epochs),
        "--batch-size",
        str(args.batch_size),
        "--patience",
        str(args.patience),
        "--label-smoothing",
        str(args.label_smoothing),
        "--grad-clip-norm",
        str(args.grad_clip_norm),
        "--learning-rate",
        str(args.learning_rate),
    ]

    print("Proper retrain command:")
    print(" ".join(command))
    if args.dry_run:
        return

    completed = subprocess.run(command, check=False)
    raise SystemExit(completed.returncode)


if __name__ == "__main__":
    main()
