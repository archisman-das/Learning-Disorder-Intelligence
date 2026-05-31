from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.dataset_tools import split_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Create train/validation/test manifest splits.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", default="data/collection/splits")
    parser.add_argument("--train-ratio", type=float, default=0.7)
    parser.add_argument("--validation-ratio", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    paths = split_manifest(
        args.manifest,
        args.output_dir,
        train_ratio=args.train_ratio,
        validation_ratio=args.validation_ratio,
        seed=args.seed,
    )
    print("Splits written:")
    for name, path in paths.items():
        print(f"- {name}: {path}")


if __name__ == "__main__":
    main()
