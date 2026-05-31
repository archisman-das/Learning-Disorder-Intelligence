from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class EyeTrackingMetrics:
    fixation_duration_ms: float
    regressions_count: int
    reading_speed_wpm: float
    gaze_dispersion: float
    scanpath_length: float
    mean_saccade_velocity: float
    session_duration_seconds: float


EYE_TRACKING_METRIC_COLUMNS = [
    "sample_id",
    "participant_hash",
    "language",
    "fixation_duration_ms",
    "regressions_count",
    "reading_speed_wpm",
    "gaze_dispersion",
    "scanpath_length",
    "mean_saccade_velocity",
    "session_duration_seconds",
    "word_count",
    "collection_date",
]


def compute_eye_tracking_metrics(
    trace: pd.DataFrame,
    word_count: int,
    fixation_velocity_threshold: float = 1.1,
    min_fixation_duration_ms: float = 120.0,
    regression_dx_threshold: float = 0.02,
) -> EyeTrackingMetrics:
    if trace.empty:
        return EyeTrackingMetrics(0.0, 0, 0.0, 0.0, 0.0, 0.0, 0.0)

    required = {"timestamp_ms", "gaze_x", "gaze_y"}
    missing = required.difference(trace.columns)
    if missing:
        raise ValueError(f"Eye trace is missing required columns: {sorted(missing)}")

    frame = trace.sort_values("timestamp_ms").reset_index(drop=True).copy()
    t = frame["timestamp_ms"].to_numpy(dtype=np.float64)
    x = frame["gaze_x"].to_numpy(dtype=np.float64)
    y = frame["gaze_y"].to_numpy(dtype=np.float64)

    dt = np.diff(t) / 1000.0
    dt[dt <= 1e-6] = 1e-6
    dx = np.diff(x)
    dy = np.diff(y)
    displacement = np.sqrt(dx**2 + dy**2)
    velocity = displacement / dt

    fixation_mask = velocity < fixation_velocity_threshold
    fixation_durations: list[float] = []
    run_start = 0
    for index in range(len(fixation_mask)):
        if not fixation_mask[index]:
            if index > run_start:
                duration_ms = (t[index] - t[run_start])
                if duration_ms >= min_fixation_duration_ms:
                    fixation_durations.append(float(duration_ms))
            run_start = index + 1
    if len(fixation_mask) > run_start:
        duration_ms = t[-1] - t[run_start]
        if duration_ms >= min_fixation_duration_ms:
            fixation_durations.append(float(duration_ms))

    regressions = int(np.sum(dx < -regression_dx_threshold))
    session_seconds = max((t[-1] - t[0]) / 1000.0, 1e-6)
    reading_speed = float(word_count / (session_seconds / 60.0)) if word_count > 0 else 0.0
    gaze_dispersion = float(np.sqrt(np.var(x) + np.var(y)))
    scanpath = float(displacement.sum())
    mean_saccade_velocity = float(velocity[~fixation_mask].mean()) if np.any(~fixation_mask) else 0.0
    mean_fixation = float(np.mean(fixation_durations)) if fixation_durations else 0.0

    return EyeTrackingMetrics(
        fixation_duration_ms=mean_fixation,
        regressions_count=regressions,
        reading_speed_wpm=reading_speed,
        gaze_dispersion=gaze_dispersion,
        scanpath_length=scanpath,
        mean_saccade_velocity=mean_saccade_velocity,
        session_duration_seconds=float(session_seconds),
    )


def append_eye_tracking_metrics(
    path: str | Path,
    sample_id: str,
    participant_hash: str,
    language: str,
    metrics: EyeTrackingMetrics,
    word_count: int,
) -> Path:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        frame = pd.read_csv(output)
    else:
        frame = pd.DataFrame(columns=EYE_TRACKING_METRIC_COLUMNS)
    for column in EYE_TRACKING_METRIC_COLUMNS:
        if column not in frame:
            frame[column] = ""

    row = {
        "sample_id": sample_id,
        "participant_hash": participant_hash,
        "language": language,
        "fixation_duration_ms": metrics.fixation_duration_ms,
        "regressions_count": metrics.regressions_count,
        "reading_speed_wpm": metrics.reading_speed_wpm,
        "gaze_dispersion": metrics.gaze_dispersion,
        "scanpath_length": metrics.scanpath_length,
        "mean_saccade_velocity": metrics.mean_saccade_velocity,
        "session_duration_seconds": metrics.session_duration_seconds,
        "word_count": int(word_count),
        "collection_date": datetime.now().date().isoformat(),
    }
    row_frame = pd.DataFrame([row], columns=EYE_TRACKING_METRIC_COLUMNS)
    if frame.empty:
        merged = row_frame
    else:
        merged = pd.concat([frame[EYE_TRACKING_METRIC_COLUMNS], row_frame], ignore_index=True)
    merged.to_csv(output, index=False)
    return output
