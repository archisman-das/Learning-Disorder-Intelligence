from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.dataset_tools import augment_audio_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Create augmented reading-audio variants and an expanded manifest.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-manifest", default="data/collection/audio_augmented_manifest.csv")
    parser.add_argument("--output-audio-dir", default="data/collection/augmented/audio")
    parser.add_argument("--variants-per-sample", type=int, default=2)
    args = parser.parse_args()
    path = augment_audio_manifest(
        args.manifest,
        args.output_manifest,
        args.output_audio_dir,
        variants_per_sample=args.variants_per_sample,
    )
    print(f"Audio-augmented manifest written to {path}")


if __name__ == "__main__":
    main()
