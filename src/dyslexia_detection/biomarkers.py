from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import wave

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from .config import DataConfig
from .preprocessing import load_handwriting_image


@dataclass(frozen=True)
class BiomarkerResult:
    dataset: pd.DataFrame
    summary: pd.DataFrame


def _resolve(root: Path, value: object) -> Path | None:
    if pd.isna(value) or not str(value).strip():
        return None
    path = Path(str(value))
    if path.is_absolute():
        return path
    return (root / path).resolve()


def _read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    if width == 1:
        data = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        data = (data - 128.0) / 128.0
    elif width == 2:
        data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif width == 4:
        data = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported sample width: {width}")
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


def handwriting_biomarkers(path: Path | None, config: DataConfig) -> dict[str, float]:
    image = load_handwriting_image(path, config)[0]
    stroke = np.clip(image, 0.0, 1.0)
    binary = (stroke > 0.35).astype(np.float32)
    horizontal_edges = np.abs(np.diff(binary, axis=1)).mean()
    vertical_edges = np.abs(np.diff(binary, axis=0)).mean()
    row_mass = stroke.mean(axis=1)
    col_mass = stroke.mean(axis=0)
    return {
        "hw_stroke_density": float(stroke.mean()),
        "hw_stroke_std": float(stroke.std()),
        "hw_edge_complexity": float(horizontal_edges + vertical_edges),
        "hw_row_variation": float(row_mass.std()),
        "hw_col_variation": float(col_mass.std()),
    }


def speech_biomarkers(path: Path | None) -> dict[str, float]:
    if path is None or not path.exists():
        return {
            "sp_duration_seconds": 0.0,
            "sp_rms_energy": 0.0,
            "sp_zero_crossing_rate": 0.0,
            "sp_spectral_centroid_hz": 0.0,
            "sp_pause_ratio": 0.0,
        }
    waveform, rate = _read_wav_mono(path)
    if waveform.size == 0:
        return {
            "sp_duration_seconds": 0.0,
            "sp_rms_energy": 0.0,
            "sp_zero_crossing_rate": 0.0,
            "sp_spectral_centroid_hz": 0.0,
            "sp_pause_ratio": 0.0,
        }
    duration = waveform.size / float(rate)
    rms = float(np.sqrt(np.mean(waveform**2) + 1e-8))
    zcr = float(np.mean(np.abs(np.diff(np.signbit(waveform)).astype(np.float32))))
    spectrum = np.abs(np.fft.rfft(waveform))
    freqs = np.fft.rfftfreq(waveform.size, d=1.0 / rate)
    centroid = float((spectrum * freqs).sum() / (spectrum.sum() + 1e-8))
    pause_ratio = float(np.mean(np.abs(waveform) < 0.015))
    return {
        "sp_duration_seconds": float(duration),
        "sp_rms_energy": rms,
        "sp_zero_crossing_rate": zcr,
        "sp_spectral_centroid_hz": centroid,
        "sp_pause_ratio": pause_ratio,
    }


def reading_biomarkers(row: pd.Series) -> dict[str, float]:
    text = str(row.get("text_sample", "") or "")
    duration = float(row.get("reading_time_seconds", 0) or 0)
    char_count = len(text)
    return {
        "rd_spelling_errors": float(row.get("spelling_errors", 0) or 0),
        "rd_pronunciation_errors": float(row.get("pronunciation_errors", 0) or 0),
        "rd_hesitation_count": float(row.get("hesitation_count", 0) or 0),
        "rd_repetition_count": float(row.get("repetition_count", 0) or 0),
        "rd_omission_count": float(row.get("omission_count", 0) or 0),
        "rd_reading_time_seconds": duration,
        "rd_chars_per_second": float(char_count / duration) if duration > 0 else 0.0,
    }


def build_biomarker_dataset(manifest_path: str | Path, config: DataConfig | None = None) -> pd.DataFrame:
    cfg = config or DataConfig()
    manifest = Path(manifest_path)
    frame = pd.read_csv(manifest)
    rows: list[dict[str, float | int | str]] = []
    for _, row in frame.iterrows():
        hw = handwriting_biomarkers(_resolve(manifest.parent, row.get("handwriting_path", "")), cfg)
        sp = speech_biomarkers(_resolve(manifest.parent, row.get("audio_path", "")))
        rd = reading_biomarkers(row)
        rows.append(
            {
                "sample_id": str(row.get("sample_id", "")),
                "label": int(float(row.get("label", 0) or 0)),
                "language": str(row.get("language", cfg.text_language)),
                **hw,
                **sp,
                **rd,
            }
        )
    return pd.DataFrame(rows)


def _cohens_d(x0: np.ndarray, x1: np.ndarray) -> float:
    if x0.size < 2 or x1.size < 2:
        return 0.0
    v0 = x0.var(ddof=1)
    v1 = x1.var(ddof=1)
    pooled = ((x0.size - 1) * v0 + (x1.size - 1) * v1) / max(1, (x0.size + x1.size - 2))
    if pooled <= 1e-12:
        return 0.0
    return float((x1.mean() - x0.mean()) / np.sqrt(pooled))


def discover_digital_biomarkers(manifest_path: str | Path, config: DataConfig | None = None) -> BiomarkerResult:
    dataset = build_biomarker_dataset(manifest_path, config=config)
    biomarker_columns = [col for col in dataset.columns if col.startswith(("hw_", "sp_", "rd_"))]
    labels = dataset["label"].astype(int).to_numpy()

    low_mask = labels == 0
    high_mask = labels > 0
    rows: list[dict[str, float | str]] = []
    for column in biomarker_columns:
        values = dataset[column].astype(float).to_numpy()
        low = values[low_mask]
        high = values[high_mask]
        d = _cohens_d(low, high)
        corr = float(np.corrcoef(values, labels)[0, 1]) if values.std() > 1e-9 else 0.0
        rows.append(
            {
                "biomarker": column,
                "mean_low_risk": float(low.mean()) if low.size else 0.0,
                "mean_dyslexia_risk": float(high.mean()) if high.size else 0.0,
                "cohens_d": d,
                "label_correlation": corr,
            }
        )

    summary = pd.DataFrame(rows)
    if not summary.empty:
        summary["importance_score"] = (summary["cohens_d"].abs() * 0.6) + (summary["label_correlation"].abs() * 0.4)
        summary = summary.sort_values("importance_score", ascending=False).reset_index(drop=True)

        features = dataset[biomarker_columns].astype(float).fillna(0.0)
        scaler = StandardScaler()
        scaled = scaler.fit_transform(features)
        if len(np.unique(labels)) >= 2:
            model = LogisticRegression(max_iter=300, class_weight="balanced")
            model.fit(scaled, labels > 0)
            coefficients = np.abs(model.coef_[0])
            coefficient_map = {column: float(value) for column, value in zip(biomarker_columns, coefficients, strict=False)}
            summary["logistic_importance"] = summary["biomarker"].map(coefficient_map).fillna(0.0)
            summary["importance_score"] = summary["importance_score"] + (0.3 * summary["logistic_importance"])
            summary = summary.sort_values("importance_score", ascending=False).reset_index(drop=True)
    return BiomarkerResult(dataset=dataset, summary=summary)
