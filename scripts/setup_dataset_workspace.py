from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.dataset_tools import create_dataset_workspace


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a complete dataset collection workspace.")
    parser.add_argument("--root", default="data/collection", help="Dataset workspace root.")
    args = parser.parse_args()
    paths = create_dataset_workspace(args.root)
    print("Dataset workspace created:")
    for name, path in paths.items():
        print(f"- {name}: {path}")


if __name__ == "__main__":
    main()
