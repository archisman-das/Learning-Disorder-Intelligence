from __future__ import annotations

from pathlib import Path
import hashlib
import os
import shutil
import wave

import numpy as np
import pandas as pd
from PIL import Image, ImageEnhance, ImageOps

from .config import DataConfig
from .preprocessing import normalize_text
from .schemas import (
    BEHAVIOR_COLUMNS,
    COLLECTION_METADATA_COLUMNS,
    EYE_TRACKING_COLUMNS,
    ERROR_DETAIL_COLUMNS,
    ETHICS_COLUMNS,
    REQUIRED_MANIFEST_COLUMNS,
)


OPTIONAL_MANIFEST_COLUMNS = set(BEHAVIOR_COLUMNS + EYE_TRACKING_COLUMNS + COLLECTION_METADATA_COLUMNS + ERROR_DETAIL_COLUMNS + ETHICS_COLUMNS)
ALL_MANIFEST_COLUMNS = [
    "sample_id",
    "student_hash",
    "handwriting_path",
    "audio_path",
    "text_sample",
    "spelling_errors",
    "pronunciation_errors",
    *BEHAVIOR_COLUMNS,
    *EYE_TRACKING_COLUMNS,
    *ERROR_DETAIL_COLUMNS,
    *ETHICS_COLUMNS,
    *COLLECTION_METADATA_COLUMNS,
    "label",
]


def create_empty_manifest(path: str | Path) -> Path:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(columns=ALL_MANIFEST_COLUMNS).to_csv(output_path, index=False)
    return output_path


def ensure_manifest(path: str | Path) -> Path:
    manifest_path = Path(path)
    if not manifest_path.exists():
        create_empty_manifest(manifest_path)
    return manifest_path


def append_manifest_row(manifest_path: str | Path, row: dict[str, object]) -> Path:
    manifest = ensure_manifest(manifest_path)
    frame = pd.read_csv(manifest)
    for column in ALL_MANIFEST_COLUMNS:
        if column not in frame:
            frame[column] = ""

    normalized_row = {column: row.get(column, "") for column in ALL_MANIFEST_COLUMNS}
    if normalized_row["sample_id"] and "sample_id" in frame:
        duplicate = frame["sample_id"].astype(str).eq(str(normalized_row["sample_id"])).any()
        if duplicate:
            raise ValueError(f"sample_id already exists: {normalized_row['sample_id']}")

    row_frame = pd.DataFrame([normalized_row], columns=ALL_MANIFEST_COLUMNS)
    if frame.empty:
        updated = row_frame
    else:
        updated = pd.concat([frame[ALL_MANIFEST_COLUMNS], row_frame], ignore_index=True)
    updated.to_csv(manifest, index=False)
    return manifest


def create_dataset_workspace(root: str | Path) -> dict[str, Path]:
    root_path = Path(root)
    paths = {
        "root": root_path,
        "raw_handwriting": root_path / "raw" / "handwriting",
        "raw_audio": root_path / "raw" / "audio",
        "processed": root_path / "processed",
        "augmented_handwriting": root_path / "augmented" / "handwriting",
        "augmented_audio": root_path / "augmented" / "audio",
        "splits": root_path / "splits",
        "docs": root_path / "docs",
    }
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    ensure_manifest(root_path / "manifest.csv")
    write_collection_protocol(root_path / "docs" / "collection_protocol.md")
    return paths


def write_collection_protocol(path: str | Path) -> Path:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "\n".join(
            [
                "# Multilingual Dyslexia Dataset Collection Protocol",
                "",
                "## Required Tasks",
                "",
                "1. Handwriting: collect letters, words, and short sentence copying samples in the selected language.",
                "2. Reading audio: record students reading letters, words, sentences, and a short passage.",
                "3. Text/language: record spelling errors, substitutions, omissions, reversals, and pronunciation notes.",
                "4. Reading behavior: measure reading time, hesitations, repetitions, and omissions.",
                "5. Eye tracking (optional): collect fixation duration, regressions, reading speed, and gaze pattern summaries.",
                "",
                "## Ethics",
                "",
                "- Obtain guardian consent and student assent before collection.",
                "- Store only anonymized IDs in the manifest.",
                "- Keep names, phone numbers, addresses, and school IDs outside the ML dataset.",
                "- Use the system only for screening and educational assistance, not clinical diagnosis.",
                "",
                "## Recommended File Layout",
                "",
                "- raw/handwriting/S001.png",
                "- raw/audio/S001.wav",
                "- manifest.csv",
            ]
        ),
        encoding="utf-8",
    )
    return output_path


def anonymize_manifest(input_path: str | Path, output_path: str | Path, salt: str) -> Path:
    frame = pd.read_csv(input_path)
    if "student_hash" not in frame:
        raise ValueError("Manifest must contain student_hash before anonymization.")

    def anonymize(value: object) -> str:
        digest = hashlib.sha256(f"{salt}:{value}".encode("utf-8")).hexdigest()
        return f"anon_{digest[:12]}"

    frame["student_hash"] = frame["student_hash"].map(anonymize)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output, index=False)
    return output


def validate_manifest(path: str | Path) -> list[str]:
    manifest_path = Path(path)
    if not manifest_path.exists():
        return [f"Manifest does not exist: {manifest_path}"]

    frame = pd.read_csv(manifest_path)
    issues: list[str] = []
    missing_required = REQUIRED_MANIFEST_COLUMNS.difference(frame.columns)
    if missing_required:
        issues.append(f"Missing required columns: {sorted(missing_required)}")

    if "label" in frame:
        invalid_labels = sorted(set(frame["label"].dropna()) - {0, 1})
        if invalid_labels:
            issues.append(f"Labels must be 0 or 1. Found: {invalid_labels}")

    for column in ["spelling_errors", "pronunciation_errors", *BEHAVIOR_COLUMNS]:
        if column in frame:
            numeric = pd.to_numeric(frame[column], errors="coerce")
            if numeric.isna().any():
                issues.append(f"Column has non-numeric values: {column}")
            if (numeric.dropna() < 0).any():
                issues.append(f"Column has negative values: {column}")

    if "sample_id" in frame and frame["sample_id"].duplicated().any():
        issues.append("sample_id values must be unique.")

    for column in ETHICS_COLUMNS:
        if column in frame:
            missing = frame[column].isna() | (frame[column].astype(str).str.strip() == "")
            if missing.any():
                issues.append(f"Ethics column has missing values: {column}")

    for column in ["guardian_consent", "student_assent"]:
        if column in frame:
            values = frame[column].astype(str).str.lower().str.strip()
            invalid = sorted(set(values) - {"yes", "no", "true", "false", "1", "0"})
            if invalid:
                issues.append(f"{column} must be yes/no or true/false. Found: {invalid}")

    for column in ["handwriting_path", "audio_path"]:
        if column in frame:
            missing_files = []
            for value in frame[column].dropna():
                if not str(value).strip():
                    continue
                file_path = Path(str(value))
                if not file_path.is_absolute():
                    file_path = manifest_path.parent / file_path
                if not file_path.exists():
                    missing_files.append(str(value))
            if missing_files:
                preview = ", ".join(missing_files[:5])
                issues.append(f"{column} contains missing files: {preview}")

    return issues


def clean_manifest(input_path: str | Path, output_path: str | Path) -> Path:
    source = Path(input_path)
    frame = pd.read_csv(source)
    for column in ALL_MANIFEST_COLUMNS:
        if column not in frame:
            frame[column] = ""

    frame = frame[ALL_MANIFEST_COLUMNS].copy()
    frame = frame.dropna(how="all")
    frame["sample_id"] = frame["sample_id"].astype(str).str.strip()
    frame = frame[frame["sample_id"] != ""]
    frame = frame.drop_duplicates(subset=["sample_id"], keep="first")

    text_columns = [
        "student_hash",
        "handwriting_path",
        "audio_path",
        "text_sample",
        "spelling_error_notes",
        "pronunciation_error_notes",
        "data_use_scope",
        "age_group",
        "grade",
        "gender",
        "language",
        "school_region",
        "device_type",
        "collection_date",
        "annotator_id",
    ]
    for column in text_columns:
        frame[column] = frame[column].fillna("").astype(str).str.strip()
    frame["text_sample"] = [
        normalize_text(text, language)
        for text, language in zip(frame["text_sample"], frame["language"], strict=False)
    ]

    for column in ["guardian_consent", "student_assent"]:
        frame[column] = frame[column].fillna("").astype(str).str.strip().str.lower()
        frame[column] = frame[column].replace({"true": "yes", "1": "yes", "false": "no", "0": "no"})

    numeric_defaults = {
        "spelling_errors": 0,
        "pronunciation_errors": 0,
        "reading_time_seconds": 0.0,
        "hesitation_count": 0,
        "repetition_count": 0,
        "omission_count": 0,
        "fixation_duration_ms": 0.0,
        "regressions_count": 0,
        "reading_speed_wpm": 0.0,
        "gaze_dispersion": 0.0,
        "scanpath_length": 0.0,
        "mean_saccade_velocity": 0.0,
        "label": 0,
    }
    for column, default in numeric_defaults.items():
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(default)
        frame[column] = frame[column].clip(lower=0)
    frame["label"] = frame["label"].clip(upper=1).astype(int)
    count_columns = [
        "spelling_errors",
        "pronunciation_errors",
        "hesitation_count",
        "repetition_count",
        "omission_count",
        "regressions_count",
    ]
    for column in count_columns:
        frame[column] = frame[column].round().astype(int)

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output, index=False)
    return output


def normalize_collected_assets(
    manifest_path: str | Path,
    output_manifest: str | Path,
    output_root: str | Path,
    config: DataConfig | None = None,
    source_root: str | Path | None = None,
) -> Path:
    config = config or DataConfig()
    manifest = Path(manifest_path)
    output = Path(output_manifest)
    root = Path(output_root)
    handwriting_dir = root / "handwriting"
    audio_dir = root / "audio"
    handwriting_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    frame = pd.read_csv(manifest)
    rows = []
    media_root = Path(source_root) if source_root is not None else manifest.parent
    for _, row in frame.iterrows():
        new_row = row.copy()
        handwriting_source = _resolve_from_root(media_root, row.get("handwriting_path", ""))
        audio_source = _resolve_from_root(media_root, row.get("audio_path", ""))

        if handwriting_source and handwriting_source.exists():
            handwriting_output = handwriting_dir / f"{row['sample_id']}.png"
            normalize_handwriting_file(handwriting_source, handwriting_output, config)
            new_row["handwriting_path"] = os.path.relpath(handwriting_output, output.parent)

        if audio_source and audio_source.exists() and audio_source.suffix.lower() == ".wav":
            audio_output = audio_dir / f"{row['sample_id']}.wav"
            normalize_audio_file(audio_source, audio_output, config)
            new_row["audio_path"] = os.path.relpath(audio_output, output.parent)

        rows.append(new_row)

    output.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(output, index=False)
    return output


def normalize_handwriting_file(input_path: str | Path, output_path: str | Path, config: DataConfig | None = None) -> Path:
    config = config or DataConfig()
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(input_path).convert("L")
    image = ImageOps.autocontrast(image)
    image = ImageOps.pad(image, (config.image_size, config.image_size), color=255)
    image.save(output)
    return output


def normalize_audio_file(input_path: str | Path, output_path: str | Path, config: DataConfig | None = None) -> Path:
    config = config or DataConfig()
    waveform_data, sample_rate = _read_wav(Path(input_path))
    if sample_rate != config.sample_rate:
        waveform_data = _resample_waveform(waveform_data, sample_rate, config.sample_rate)
    waveform_data = _trim_silence(waveform_data)
    waveform_data = _normalize_waveform_volume(waveform_data)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    _write_wav(output, waveform_data, config.sample_rate)
    return output


def prepare_dataset(
    manifest_path: str | Path,
    output_root: str | Path,
    handwriting_variants: int = 2,
    audio_variants: int = 2,
) -> dict[str, Path]:
    output = Path(output_root)
    output.mkdir(parents=True, exist_ok=True)
    cleaned = clean_manifest(manifest_path, output / "clean_manifest.csv")
    normalized = normalize_collected_assets(
        cleaned,
        output / "normalized_manifest.csv",
        output / "normalized",
        source_root=Path(manifest_path).parent,
    )
    handwriting_augmented = augment_handwriting_manifest(
        normalized,
        output / "handwriting_augmented_manifest.csv",
        output / "augmented" / "handwriting",
        variants_per_sample=handwriting_variants,
    )
    audio_augmented = augment_audio_manifest(
        handwriting_augmented,
        output / "prepared_manifest.csv",
        output / "augmented" / "audio",
        variants_per_sample=audio_variants,
    )
    return {
        "cleaned_manifest": cleaned,
        "normalized_manifest": normalized,
        "handwriting_augmented_manifest": handwriting_augmented,
        "prepared_manifest": audio_augmented,
    }


def split_manifest(
    manifest_path: str | Path,
    output_dir: str | Path,
    train_ratio: float = 0.7,
    validation_ratio: float = 0.15,
    seed: int = 42,
) -> dict[str, Path]:
    frame = pd.read_csv(manifest_path)
    if not 0 < train_ratio < 1 or not 0 <= validation_ratio < 1:
        raise ValueError("Ratios must be between 0 and 1.")
    if train_ratio + validation_ratio >= 1:
        raise ValueError("train_ratio + validation_ratio must be less than 1.")

    if "label" in frame and frame["label"].nunique() > 1:
        split_parts = {"train": [], "validation": [], "test": []}
        for _, group in frame.groupby("label"):
            shuffled_group = group.sample(frac=1.0, random_state=seed).reset_index(drop=True)
            total = len(shuffled_group)
            train_end = int(total * train_ratio)
            validation_end = train_end + int(total * validation_ratio)
            split_parts["train"].append(shuffled_group.iloc[:train_end])
            split_parts["validation"].append(shuffled_group.iloc[train_end:validation_end])
            split_parts["test"].append(shuffled_group.iloc[validation_end:])
        splits = {
            name: pd.concat(parts).sample(frac=1.0, random_state=seed).reset_index(drop=True)
            for name, parts in split_parts.items()
        }
    else:
        shuffled = frame.sample(frac=1.0, random_state=seed).reset_index(drop=True)
        total = len(shuffled)
        train_end = int(total * train_ratio)
        validation_end = train_end + int(total * validation_ratio)
        splits = {
            "train": shuffled.iloc[:train_end],
            "validation": shuffled.iloc[train_end:validation_end],
            "test": shuffled.iloc[validation_end:],
        }

    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, split_frame in splits.items():
        path = output / f"{name}.csv"
        portable_frame = _rewrite_path_columns(split_frame.copy(), Path(manifest_path).parent, path.parent)
        portable_frame.to_csv(path, index=False)
        paths[name] = path
    return paths


def augment_handwriting_manifest(
    manifest_path: str | Path,
    output_manifest: str | Path,
    output_image_dir: str | Path,
    variants_per_sample: int = 2,
) -> Path:
    manifest = Path(manifest_path)
    frame = pd.read_csv(manifest)
    image_dir = Path(output_image_dir)
    image_dir.mkdir(parents=True, exist_ok=True)
    rows = [frame]
    augmented_rows = []

    for _, row in frame.iterrows():
        source = Path(str(row["handwriting_path"]))
        if not source.is_absolute():
            source = manifest.parent / source
        if not source.exists():
            continue
        for variant in range(variants_per_sample):
            image = Image.open(source).convert("L")
            angle = [-4, 4, -2, 2][variant % 4]
            brightness = 0.9 + (0.1 * ((variant % 3) + 1))
            augmented = image.rotate(angle, expand=False, fillcolor=255)
            augmented = ImageEnhance.Brightness(augmented).enhance(brightness)
            output_name = f"{row['sample_id']}_aug{variant + 1}.png"
            output_path = image_dir / output_name
            augmented.save(output_path)

            new_row = row.copy()
            new_row["sample_id"] = f"{row['sample_id']}_aug{variant + 1}"
            new_row["handwriting_path"] = str(output_path.relative_to(Path(output_manifest).parent))
            augmented_rows.append(new_row)

    if augmented_rows:
        rows.append(pd.DataFrame(augmented_rows))
    output = Path(output_manifest)
    output.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(rows, ignore_index=True).to_csv(output, index=False)
    return output


def copy_audio_for_augmented_manifest(source_manifest: str | Path, target_manifest: str | Path) -> Path:
    source = Path(source_manifest)
    target = Path(target_manifest)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    return target


def augment_audio_manifest(
    manifest_path: str | Path,
    output_manifest: str | Path,
    output_audio_dir: str | Path,
    variants_per_sample: int = 2,
) -> Path:
    manifest = Path(manifest_path)
    frame = pd.read_csv(manifest)
    audio_dir = Path(output_audio_dir)
    audio_dir.mkdir(parents=True, exist_ok=True)
    rows = [frame]
    augmented_rows = []

    for _, row in frame.iterrows():
        source = Path(str(row["audio_path"]))
        if not source.is_absolute():
            source = manifest.parent / source
        if not source.exists() or source.suffix.lower() != ".wav":
            continue
        waveform_data, sample_rate = _read_wav(source)
        for variant in range(variants_per_sample):
            augmented = _augment_waveform(waveform_data, variant)
            output_name = f"{row['sample_id']}_audio_aug{variant + 1}.wav"
            output_path = audio_dir / output_name
            _write_wav(output_path, augmented, sample_rate)

            new_row = row.copy()
            new_row["sample_id"] = f"{row['sample_id']}_audio_aug{variant + 1}"
            new_row["audio_path"] = str(output_path.relative_to(Path(output_manifest).parent))
            augmented_rows.append(new_row)

    if augmented_rows:
        rows.append(pd.DataFrame(augmented_rows))
    output = Path(output_manifest)
    output.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(rows, ignore_index=True).to_csv(output, index=False)
    return output


def _read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        sample_rate = handle.getframerate()
        channels = handle.getnchannels()
        frames = handle.readframes(handle.getnframes())
    data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, sample_rate


def _resolve_from_root(root: Path, value: object) -> Path | None:
    if pd.isna(value) or not str(value).strip():
        return None
    path = Path(str(value))
    return path if path.is_absolute() else root / path


def _resample_waveform(waveform_data: np.ndarray, old_rate: int, new_rate: int) -> np.ndarray:
    if old_rate == new_rate or waveform_data.size == 0:
        return waveform_data
    duration = waveform_data.size / old_rate
    old_times = np.linspace(0, duration, num=waveform_data.size, endpoint=False)
    new_size = max(1, int(duration * new_rate))
    new_times = np.linspace(0, duration, num=new_size, endpoint=False)
    return np.interp(new_times, old_times, waveform_data).astype(np.float32)


def _trim_silence(waveform_data: np.ndarray, threshold: float = 0.01) -> np.ndarray:
    if waveform_data.size == 0:
        return waveform_data
    active = np.where(np.abs(waveform_data) > threshold)[0]
    if active.size == 0:
        return waveform_data
    start = max(0, int(active[0]) - 400)
    end = min(waveform_data.size, int(active[-1]) + 400)
    return waveform_data[start:end]


def _normalize_waveform_volume(waveform_data: np.ndarray, target_peak: float = 0.8) -> np.ndarray:
    if waveform_data.size == 0:
        return waveform_data
    peak = float(np.max(np.abs(waveform_data)))
    if peak < 1e-6:
        return waveform_data.astype(np.float32)
    return np.clip(waveform_data * (target_peak / peak), -1.0, 1.0).astype(np.float32)


def _write_wav(path: Path, waveform_data: np.ndarray, sample_rate: int) -> None:
    pcm = np.clip(waveform_data * 32767, -32768, 32767).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.tobytes())


def _augment_waveform(waveform_data: np.ndarray, variant: int) -> np.ndarray:
    if waveform_data.size == 0:
        return waveform_data
    rng = np.random.default_rng(variant)
    gain = [0.85, 1.1, 0.95][variant % 3]
    noise_level = [0.004, 0.008, 0.002][variant % 3]
    augmented = waveform_data * gain
    augmented = augmented + rng.normal(0.0, noise_level, size=augmented.shape)
    if variant % 2 == 1:
        shift = min(len(augmented) // 20, 1200)
        augmented = np.roll(augmented, shift)
        augmented[:shift] = 0.0
    return np.clip(augmented, -1.0, 1.0).astype(np.float32)


def _rewrite_path_columns(frame: pd.DataFrame, source_root: Path, target_root: Path) -> pd.DataFrame:
    for column in ["handwriting_path", "audio_path"]:
        if column not in frame:
            continue
        rewritten = []
        for value in frame[column]:
            if pd.isna(value) or not str(value).strip():
                rewritten.append(value)
                continue
            path = Path(str(value))
            absolute = path if path.is_absolute() else (source_root / path).resolve()
            rewritten.append(os.path.relpath(absolute, target_root.resolve()))
        frame[column] = rewritten
    return frame
