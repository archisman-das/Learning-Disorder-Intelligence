from __future__ import annotations

import pandas as pd


SEVERITY_LABELS = {
    0: "mild",
    1: "moderate",
    2: "severe",
}


def clamp_severity_label(value: int) -> int:
    if value < 0:
        return 0
    if value > 2:
        return 2
    return int(value)


def severity_from_score(score: float) -> int:
    if score < 0.34:
        return 0
    if score < 0.67:
        return 1
    return 2


def severity_score_from_row(row: pd.Series) -> float:
    # Weighted behavior/error burden to approximate progression from mild to severe.
    spelling = float(row.get("spelling_errors", 0) or 0)
    pronunciation = float(row.get("pronunciation_errors", 0) or 0)
    reading_time = float(row.get("reading_time_seconds", 0) or 0)
    hesitations = float(row.get("hesitation_count", 0) or 0)
    repetitions = float(row.get("repetition_count", 0) or 0)
    omissions = float(row.get("omission_count", 0) or 0)

    base = (
        (spelling * 0.14)
        + (pronunciation * 0.16)
        + (min(reading_time / 90.0, 2.0) * 0.25)
        + (hesitations * 0.1)
        + (repetitions * 0.08)
        + (omissions * 0.12)
    )
    normalized = max(0.0, min(base / 2.5, 1.0))
    return float(round(normalized, 4))


def derive_severity_targets(row: pd.Series) -> tuple[int, float]:
    if "severity_score" in row and not pd.isna(row["severity_score"]):
        score = float(row["severity_score"])
        score = max(0.0, min(score, 1.0))
    else:
        score = severity_score_from_row(row)

    if "severity_label" in row and not pd.isna(row["severity_label"]):
        label = clamp_severity_label(int(row["severity_label"]))
    else:
        label = severity_from_score(score)
    return label, score
