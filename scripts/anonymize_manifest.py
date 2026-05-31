from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.dataset_tools import anonymize_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Anonymize student identifiers in a manifest.")
    parser.add_argument("--input", required=True, help="Input manifest path.")
    parser.add_argument("--output", required=True, help="Output anonymized manifest path.")
    parser.add_argument("--salt", required=True, help="Private salt used for reproducible hashing.")
    args = parser.parse_args()
    path = anonymize_manifest(args.input, args.output, args.salt)
    print(f"Anonymized manifest written to {path}")


if __name__ == "__main__":
    main()
