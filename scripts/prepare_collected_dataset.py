from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.dataset_tools import prepare_dataset, split_manifest, validate_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean, normalize, augment, and split a collected dataset.")
    parser.add_argument("--manifest", default="data/collection/manifest.csv")
    parser.add_argument("--output-root", default="data/collection/processed")
    parser.add_argument("--handwriting-variants", type=int, default=2)
    parser.add_argument("--audio-variants", type=int, default=2)
    parser.add_argument("--split", action="store_true", help="Also create train/validation/test splits.")
    args = parser.parse_args()

    outputs = prepare_dataset(
        args.manifest,
        args.output_root,
        handwriting_variants=args.handwriting_variants,
        audio_variants=args.audio_variants,
    )

    for name, path in outputs.items():
        print(f"{name}: {path}")

    issues = validate_manifest(outputs["prepared_manifest"])
    if issues:
        print("Prepared manifest validation issues:")
        for issue in issues:
            print(f"- {issue}")
    else:
        print("Prepared manifest validation passed.")

    if args.split:
        split_paths = split_manifest(outputs["prepared_manifest"], Path(args.output_root) / "splits")
        for name, path in split_paths.items():
            print(f"{name}_split: {path}")


if __name__ == "__main__":
    main()
