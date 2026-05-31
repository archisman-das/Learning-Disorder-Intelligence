from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.dataset_tools import create_empty_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Bengali dyslexia dataset collection template.")
    parser.add_argument(
        "--output",
        default="data/collection/manifest_template.csv",
        help="Path where the empty manifest CSV should be written.",
    )
    args = parser.parse_args()
    path = create_empty_manifest(args.output)
    print(f"Collection template written to {path}")


if __name__ == "__main__":
    main()
