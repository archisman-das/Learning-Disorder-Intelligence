from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class EducationalExplanation:
    summary: str
    teacher: str
    parent: str
    student: str
    next_steps: list[str]


def _risk_band(confidence: float) -> str:
    if confidence >= 0.8:
        return "high"
    if confidence >= 0.6:
        return "moderate"
    return "low"


def _top_modalities(modality_attention: dict[str, float] | None) -> str:
    if not modality_attention:
        return "handwriting, speech, and reading behavior"
    ranked = sorted(modality_attention.items(), key=lambda item: item[1], reverse=True)
    names = [name.replace("_features", "").replace("_", " ") for name, _ in ranked[:2]]
    return " and ".join(names) if len(names) > 1 else names[0]


def build_educational_explanation(
    label_text: str,
    confidence: float,
    probabilities: np.ndarray,
    spelling_errors: int,
    pronunciation_errors: int,
    reading_time_seconds: float,
    hesitation_count: int,
    repetition_count: int,
    omission_count: int,
    sample_language: str,
    modality_attention: dict[str, float] | None = None,
) -> EducationalExplanation:
    band = _risk_band(float(confidence))
    risk_signal = "elevated" if ("elevated" in label_text.lower() or "moderate" in label_text.lower() or "severe" in label_text.lower()) else "low"
    evidence_focus = _top_modalities(modality_attention)
    total_errors = int(spelling_errors) + int(pronunciation_errors)
    flow_markers = int(hesitation_count) + int(repetition_count) + int(omission_count)

    summary = (
        f"Screening suggests {label_text.lower()} with {confidence:.1%} confidence. "
        f"The strongest clues came from {evidence_focus} in {sample_language.lower()} tasks."
    )

    teacher = (
        f"Classroom view: this sample shows a {risk_signal} risk pattern ({band} certainty). "
        f"Observed language-load markers include {total_errors} spelling/pronunciation errors and "
        f"{flow_markers} fluency disruptions. Use short, structured decoding tasks and re-screen after guided practice."
    )
    parent = (
        f"Family view: this is an early screening signal, not a diagnosis. "
        f"We noticed learning strain in reading/writing performance ({confidence:.1%} certainty). "
        f"Support with 10-15 minute daily reading routines, calm correction, and progress tracking over 2-4 weeks."
    )
    student = (
        "Student view: your reading pattern shows where we can help you improve next. "
        "You are not being judged. We will practice small steps: sound-out words, slow clear reading, and short spelling drills."
    )

    next_steps = [
        "Repeat screening with 2-3 additional samples collected on different days.",
        "Start personalized reading, pronunciation, and spelling exercises from the intervention panel.",
        "Share this report with a teacher or specialist if risk remains elevated after follow-up practice.",
    ]
    if reading_time_seconds > 0:
        next_steps.append(f"Current reading time was {reading_time_seconds:.1f}s; track whether this decreases with practice.")
    if probabilities.shape[0] == 3:
        next_steps.append(
            f"Severity distribution: Mild {probabilities[0]:.1%}, Moderate {probabilities[1]:.1%}, Severe {probabilities[2]:.1%}."
        )

    return EducationalExplanation(
        summary=summary,
        teacher=teacher,
        parent=parent,
        student=student,
        next_steps=next_steps,
    )
