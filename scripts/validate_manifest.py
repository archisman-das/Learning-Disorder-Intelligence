from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.dataset_tools import validate_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a dyslexia dataset manifest.")
    parser.add_argument("--manifest", required=True, help="Path to the manifest CSV.")
    args = parser.parse_args()

    issues = validate_manifest(args.manifest)
    if issues:
        print("Manifest validation failed:")
        for issue in issues:
            print(f"- {issue}")
        sys.exit(1)

    print("Manifest validation passed.")


if __name__ == "__main__":
    main()
