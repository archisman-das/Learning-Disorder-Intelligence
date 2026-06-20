from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.schemas import COLLECTION_METADATA_COLUMNS, ERROR_DETAIL_COLUMNS, ETHICS_COLUMNS, EYE_TRACKING_COLUMNS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a stricter manifest by keeping only clean, non-augmented rows.")
    parser.add_argument(
        "--inputs",
        nargs="+",
        required=True,
        help="One or more manifest CSV files to combine.",
    )
    parser.add_argument(
        "--output",
        default="data/benchmarks/tough_confidence_manifest.csv",
        help="Where to write the tougher manifest.",
    )
    parser.add_argument(
        "--drop-augmented",
        action="store_true",
        help="Drop rows whose sample_id looks like an augmented variant (_aug or _audio_aug).",
    )
    parser.add_argument(
        "--dedupe-sample-id",
        action="store_true",
        help="Keep only the first occurrence of each sample_id after combining inputs.",
    )
    parser.add_argument(
        "--strip-optional-columns",
        action="store_true",
        help="Remove optional ethics, metadata, error-detail, and eye-tracking columns from the output manifest.",
    )
    return parser.parse_args()


def _load_manifest(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    frame["__source_manifest"] = str(path)
    return frame


def _is_augmented(sample_id: object) -> bool:
    text = str(sample_id).strip().lower()
    return "_aug" in text or "_audio_aug" in text


def _rewrite_paths(frame: pd.DataFrame, output_dir: Path) -> pd.DataFrame:
    rewritten = frame.copy()
    for idx, row in rewritten.iterrows():
        source_manifest = Path(str(row.get("__source_manifest", "")))
        source_root = source_manifest.parent if source_manifest.exists() else output_dir
        for column in ("handwriting_path", "audio_path"):
            value = row.get(column, "")
            if pd.isna(value) or not str(value).strip():
                continue
            path = Path(str(value))
            absolute = path if path.is_absolute() else (source_root / path).resolve()
            rewritten.at[idx, column] = os.path.relpath(absolute, output_dir.resolve())
    return rewritten


def main() -> None:
    args = parse_args()
    input_paths = [Path(value).expanduser() for value in args.inputs]
    frames: list[pd.DataFrame] = []
    for path in input_paths:
        if not path.exists():
            raise SystemExit(f"Manifest not found: {path}")
        frames.append(_load_manifest(path))

    combined = pd.concat(frames, ignore_index=True, sort=False)
    if args.drop_augmented and "sample_id" in combined.columns:
        combined = combined[~combined["sample_id"].map(_is_augmented)]
    if args.dedupe_sample_id and "sample_id" in combined.columns:
        combined = combined.drop_duplicates(subset=["sample_id"], keep="first")

    if args.strip_optional_columns:
        optional_columns = [*ETHICS_COLUMNS, *COLLECTION_METADATA_COLUMNS, *ERROR_DETAIL_COLUMNS, *EYE_TRACKING_COLUMNS]
        combined = combined.drop(columns=optional_columns, errors="ignore")

    output = Path(args.output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    combined = _rewrite_paths(combined, output.parent)
    combined = combined.drop(columns=["__source_manifest"], errors="ignore")
    combined.to_csv(output, index=False)

    label_counts = combined["label"].value_counts().to_dict() if "label" in combined.columns else {}
    print(f"wrote={output}")
    print(f"rows={len(combined)}")
    print(f"labels={label_counts}")


if __name__ == "__main__":
    main()
