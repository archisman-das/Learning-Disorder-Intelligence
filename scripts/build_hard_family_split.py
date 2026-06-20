from __future__ import annotations

import argparse
import shutil
import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.schemas import COLLECTION_METADATA_COLUMNS, ERROR_DETAIL_COLUMNS, ETHICS_COLUMNS, EYE_TRACKING_COLUMNS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a family-safe hard split from clean manifest rows.")
    parser.add_argument(
        "--inputs",
        nargs="+",
        required=True,
        help="One or more clean manifest CSV files to combine.",
    )
    parser.add_argument(
        "--output-dir",
        default="data/benchmarks/hard_family_split",
        help="Directory where train/validation/final-eval CSVs will be written.",
    )
    parser.add_argument(
        "--final-fraction",
        type=float,
        default=0.25,
        help="Fraction of unique families to reserve for final evaluation.",
    )
    parser.add_argument(
        "--validation-fraction",
        type=float,
        default=0.25,
        help="Fraction of the remaining families to reserve for validation.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Deterministic shuffle seed used for tie-breaking and balancing.",
    )
    parser.add_argument(
        "--difficulty-gap-families",
        type=int,
        default=2,
        help="Number of hardest families to skip between final-eval and validation within each label.",
    )
    parser.add_argument(
        "--drop-augmented",
        action="store_true",
        help="Drop rows whose sample_id looks like an augmented variant (_aug or _audio_aug).",
    )
    parser.add_argument(
        "--strip-optional-columns",
        action="store_true",
        help="Remove optional ethics, metadata, error-detail, and eye-tracking columns from the output splits.",
    )
    return parser.parse_args()


def _load_manifest(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    frame["__source_manifest"] = str(path)
    frame["__source_root"] = str(path.expanduser().resolve().parent)
    return frame


def _family_id(sample_id: object) -> str:
    text = str(sample_id).strip()
    if not text:
        return ""
    pattern = re.compile(r"(?:_audio)?_aug\d+$", re.IGNORECASE)
    while True:
        cleaned = pattern.sub("", text)
        if cleaned == text:
            return text
        text = cleaned


def _is_augmented(sample_id: object) -> bool:
    text = str(sample_id).strip().lower()
    return "_aug" in text or "_audio_aug" in text


def _rewrite_paths(frame: pd.DataFrame, output_dir: Path) -> pd.DataFrame:
    rewritten = frame.copy()
    for idx, row in rewritten.iterrows():
        source_root_text = str(row.get("__source_root", "")).strip()
        source_root = Path(source_root_text).expanduser().resolve() if source_root_text else output_dir
        sample_id = str(row.get("sample_id", f"row_{idx}")).strip() or f"row_{idx}"
        for column in ("handwriting_path", "audio_path"):
            value = row.get(column, "")
            if pd.isna(value) or not str(value).strip():
                continue
            path = Path(str(value))
            absolute = path if path.is_absolute() else (source_root / path).resolve()
            if not absolute.exists():
                continue
            target_dir = output_dir / column.replace("_path", "")
            target_dir.mkdir(parents=True, exist_ok=True)
            target_path = target_dir / f"{sample_id}{absolute.suffix}"
            if not target_path.exists():
                shutil.copy2(absolute, target_path)
            rewritten.at[idx, column] = str(Path(column.replace("_path", "")) / target_path.name)
    return rewritten


def _family_difficulty_score(row: pd.Series) -> float:
    spelling_errors = float(row.get("spelling_errors", 0) or 0)
    pronunciation_errors = float(row.get("pronunciation_errors", 0) or 0)
    reading_time = float(row.get("reading_time_seconds", 0) or 0)
    hesitation_count = float(row.get("hesitation_count", 0) or 0)
    repetition_count = float(row.get("repetition_count", 0) or 0)
    omission_count = float(row.get("omission_count", 0) or 0)
    return (
        (spelling_errors * 1.6)
        + (pronunciation_errors * 1.8)
        + (reading_time / 12.0)
        + (hesitation_count * 1.3)
        + (repetition_count * 1.1)
        + (omission_count * 1.5)
    )


def _allocate_balanced_quotas(available: pd.Series, total: int) -> dict[int, int]:
    labels = [int(value) for value in sorted(available.index.tolist())]
    if not labels or total <= 0:
        return {label: 0 for label in labels}

    quotas = {label: 0 for label in labels}
    remaining = int(total)
    base = total // len(labels)
    for label in labels:
        take = min(base, int(available.get(label, 0)))
        quotas[label] = take
        remaining -= take

    if remaining <= 0:
        return quotas

    label_order = sorted(labels, key=lambda label: (int(available.get(label, 0)) - quotas[label], int(available.get(label, 0)), -label), reverse=True)
    while remaining > 0:
        progressed = False
        for label in label_order:
            if quotas[label] < int(available.get(label, 0)):
                quotas[label] += 1
                remaining -= 1
                progressed = True
                if remaining <= 0:
                    break
        if not progressed:
            break
    return quotas


def _select_hardest_by_label(family_df: pd.DataFrame, total: int, *, skip: int = 0) -> pd.DataFrame:
    if family_df.empty or total <= 0:
        return family_df.iloc[0:0].copy()

    quotas = _allocate_balanced_quotas(family_df["label"].value_counts().sort_index(), total)
    selected_frames = []
    for label, quota in quotas.items():
        if quota <= 0:
            continue
        label_frame = family_df[family_df["label"] == label].copy().sort_values(
            by=["difficulty", "size", "family_id"],
            ascending=[False, False, True],
            kind="mergesort",
        )
        if skip > 0:
            label_frame = label_frame.iloc[int(skip):]
        selected_frames.append(label_frame.head(quota))

    if not selected_frames:
        return family_df.iloc[0:0].copy()

    selected = pd.concat(selected_frames, ignore_index=True)
    if len(selected) < total:
        remaining = family_df.loc[~family_df["family_id"].isin(selected["family_id"])].copy().sort_values(
            by=["difficulty", "size", "family_id"],
            ascending=[False, False, True],
            kind="mergesort",
        )
        selected = pd.concat([selected, remaining.head(total - len(selected))], ignore_index=True)

    return selected.drop_duplicates(subset=["family_id"], keep="first")


def _choose_families(frame: pd.DataFrame, final_fraction: float, validation_fraction: float, seed: int, difficulty_gap_families: int) -> tuple[list[str], list[str], list[str]]:
    family_rows = []
    for family_id, family_frame in frame.groupby("_family_id", dropna=False):
        family_frame = family_frame.copy()
        family_frame["__difficulty"] = family_frame.apply(_family_difficulty_score, axis=1)
        label = int(pd.to_numeric(family_frame["label"], errors="coerce").fillna(0).astype(int).iloc[0])
        family_rows.append(
            {
                "family_id": str(family_id),
                "label": label,
                "difficulty": float(family_frame["__difficulty"].mean()),
                "size": int(len(family_frame)),
            }
        )

    family_df = pd.DataFrame(family_rows).reset_index(drop=True)

    if family_df.empty:
        return [], [], []

    final_count = max(1, int(round(len(family_df) * final_fraction)))
    final_count = min(final_count, len(family_df) - 2) if len(family_df) >= 3 else len(family_df)
    final_frame = _select_hardest_by_label(family_df, final_count)
    remaining = family_df.loc[~family_df["family_id"].isin(final_frame["family_id"])].copy()
    final_families = final_frame["family_id"].tolist()

    validation_count = max(1, int(round(len(remaining) * validation_fraction))) if len(remaining) > 1 else 0
    validation_count = min(validation_count, max(0, len(remaining) - 1))
    validation_frame = _select_hardest_by_label(remaining, validation_count, skip=max(0, int(difficulty_gap_families)))
    train_frame = remaining.loc[~remaining["family_id"].isin(validation_frame["family_id"])].copy()
    validation_families = validation_frame["family_id"].tolist()
    train_families = train_frame["family_id"].tolist()

    if len(train_families) == 0 and validation_families:
        train_families.append(validation_families.pop())
    if len(validation_families) == 0 and len(train_families) > 1:
        validation_families.append(train_families.pop())

    return train_families, validation_families, final_families


def _write_split(frame: pd.DataFrame, path: Path, source_dir: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    output = _rewrite_paths(frame.drop(columns=["_family_id", "__source_manifest"], errors="ignore"), source_dir)
    output.to_csv(path, index=False)
    return path


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

    combined = combined.copy()
    combined["_family_id"] = combined["sample_id"].map(_family_id)
    combined = combined[combined["_family_id"].astype(str).str.strip() != ""].copy()
    combined = combined.drop_duplicates(subset=["sample_id"], keep="first")

    if args.strip_optional_columns:
        optional_columns = [*ETHICS_COLUMNS, *COLLECTION_METADATA_COLUMNS, *ERROR_DETAIL_COLUMNS, *EYE_TRACKING_COLUMNS]
        combined = combined.drop(columns=optional_columns, errors="ignore")

    train_families, validation_families, final_families = _choose_families(
        combined,
        final_fraction=args.final_fraction,
        validation_fraction=args.validation_fraction,
        seed=args.seed,
        difficulty_gap_families=args.difficulty_gap_families,
    )

    final_frame = combined[combined["_family_id"].isin(final_families)].copy()
    validation_frame = combined[combined["_family_id"].isin(validation_families)].copy()
    train_frame = combined[combined["_family_id"].isin(train_families)].copy()

    output_dir = Path(args.output_dir).expanduser()
    train_path = _write_split(train_frame, output_dir / "train.csv", output_dir)
    validation_path = _write_split(validation_frame, output_dir / "validation.csv", output_dir)
    final_path = _write_split(final_frame, output_dir / "final_eval.csv", output_dir)

    summary = {
        "inputs": [str(path) for path in input_paths],
        "output_dir": str(output_dir),
        "train_rows": int(len(train_frame)),
        "validation_rows": int(len(validation_frame)),
        "final_eval_rows": int(len(final_frame)),
        "train_families": int(train_frame["_family_id"].nunique()),
        "validation_families": int(validation_frame["_family_id"].nunique()),
        "final_eval_families": int(final_frame["_family_id"].nunique()),
        "label_counts": combined["label"].value_counts().to_dict() if "label" in combined.columns else {},
        "train_path": str(train_path),
        "validation_path": str(validation_path),
        "final_eval_path": str(final_path),
    }
    (output_dir / "split_summary.json").write_text(pd.Series(summary).to_json(indent=2), encoding="utf-8")

    print(f"wrote={output_dir}")
    print(f"train_rows={len(train_frame)} validation_rows={len(validation_frame)} final_eval_rows={len(final_frame)}")
    print(f"train_families={train_frame['_family_id'].nunique()} validation_families={validation_frame['_family_id'].nunique()} final_eval_families={final_frame['_family_id'].nunique()}")
    print(f"label_counts={combined['label'].value_counts().to_dict() if 'label' in combined.columns else {}}")


if __name__ == "__main__":
    main()
