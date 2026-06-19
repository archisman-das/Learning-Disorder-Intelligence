from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
import os
import wave

import pandas as pd


THERAPY_SESSION_COLUMNS = [
    "session_id",
    "student_hash",
    "task_id",
    "language",
    "level",
    "target_sound",
    "prompt",
    "audio_path",
    "duration_seconds",
    "pronunciation_errors",
    "syllable_repetitions",
    "sound_substitutions",
    "attention_rating",
    "therapy_score",
    "recommendation",
    "session_date",
]


@dataclass(frozen=True)
class SpeechTherapyTask:
    task_id: str
    language: str
    level: str
    target_sound: str
    prompt: str
    goal: str


@dataclass(frozen=True)
class TherapyResult:
    therapy_score: float
    recommendation: str
    next_level: str


SPEECH_THERAPY_TASKS = [
    SpeechTherapyTask("bn_letter_ka", "Bengali", "Letter", "\u0995", "\u0995 \u0995 \u0995, \u0995\u09be \u0995\u09bf \u0995\u09c1", "Clear articulation of Bengali à¦• sound"),
    SpeechTherapyTask("bn_letter_ba", "Bengali", "Letter", "\u09ac", "\u09ac \u09ac \u09ac, \u09ac\u09be \u09ac\u09bf \u09ac\u09c1", "Clear articulation of Bengali à¦¬ sound"),
    SpeechTherapyTask("bn_word_short", "Bengali", "Word", "\u09ab/\u09a8", "\u09ab\u09c1\u09b2, \u09a8\u09a6\u09c0, \u09ac\u0987", "Slow accurate Bengali short-word reading"),
    SpeechTherapyTask("bn_sentence_easy", "Bengali", "Sentence", "sentence fluency", "\u0986\u09ae\u09bf \u09ac\u09be\u0982\u09b2\u09be \u09aa\u09dc\u09bf", "Smooth Bengali sentence reading"),
    SpeechTherapyTask("en_letter_b", "English", "Letter", "b/d", "bat, dad, bad, dab", "Differentiate common letter-sound confusions"),
    SpeechTherapyTask("en_sentence_easy", "English", "Sentence", "sentence fluency", "I read a short book", "Smooth English sentence reading"),
]


def create_therapy_workspace(root: str | Path) -> dict[str, Path]:
    root_path = Path(root)
    paths = {
        "root": root_path,
        "audio": root_path / "speech_audio",
        "sessions": root_path / "therapy_sessions.csv",
    }
    paths["audio"].mkdir(parents=True, exist_ok=True)
    ensure_therapy_log(paths["sessions"])
    return paths


def ensure_therapy_log(path: str | Path) -> Path:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not output_path.exists():
        pd.DataFrame(columns=THERAPY_SESSION_COLUMNS).to_csv(output_path, index=False)
    return output_path


def estimate_wav_duration(path: str | Path | None) -> float:
    if path is None:
        return 0.0
    audio_path = Path(path)
    if not audio_path.exists() or audio_path.suffix.lower() != ".wav":
        return 0.0
    with wave.open(str(audio_path), "rb") as handle:
        frames = handle.getnframes()
        sample_rate = handle.getframerate()
    if sample_rate <= 0:
        return 0.0
    return frames / float(sample_rate)


def score_therapy_session(
    duration_seconds: float,
    pronunciation_errors: int,
    syllable_repetitions: int,
    sound_substitutions: int,
    attention_rating: int,
) -> TherapyResult:
    error_load = pronunciation_errors * 0.35 + syllable_repetitions * 0.25 + sound_substitutions * 0.4
    pace_penalty = max(0.0, duration_seconds - 20.0) / 20.0
    attention = max(1, min(attention_rating, 5))
    attention_penalty = max(0, 3 - attention) * 0.08
    attention_bonus = max(0, attention - 3) * 0.03
    raw_score = 1.0 - min(0.95, (error_load / 5.0) + pace_penalty * 0.2 + attention_penalty) + attention_bonus
    therapy_score = round(max(0.0, min(raw_score, 1.0)), 3)

    if therapy_score >= 0.8:
        return TherapyResult(
            therapy_score=therapy_score,
            recommendation="Move to a longer prompt and keep one review round for the target sound.",
            next_level="advance",
        )
    if therapy_score >= 0.55:
        return TherapyResult(
            therapy_score=therapy_score,
            recommendation="Repeat the same prompt with syllable tapping and slow teacher modeling.",
            next_level="repeat",
        )
    return TherapyResult(
        therapy_score=therapy_score,
        recommendation="Step back to letter or syllable practice before trying the full prompt again.",
        next_level="simplify",
    )


def append_therapy_session(log_path: str | Path, row: dict[str, object]) -> Path:
    log = ensure_therapy_log(log_path)
    frame = pd.read_csv(log)
    for column in THERAPY_SESSION_COLUMNS:
        if column not in frame:
            frame[column] = ""
    normalized_row = {column: row.get(column, "") for column in THERAPY_SESSION_COLUMNS}
    if not normalized_row["session_date"]:
        normalized_row["session_date"] = datetime.now().isoformat(timespec="seconds")
    row_frame = pd.DataFrame([normalized_row], columns=THERAPY_SESSION_COLUMNS)
    if frame.empty:
        updated = row_frame
    else:
        updated = pd.concat([frame[THERAPY_SESSION_COLUMNS], row_frame], ignore_index=True)
    updated.to_csv(log, index=False)
    return log


def therapy_task_frame() -> pd.DataFrame:
    return pd.DataFrame([asdict(task) for task in SPEECH_THERAPY_TASKS])


def speech_therapy_tasks_for_language(language: str) -> list[SpeechTherapyTask]:
    key = str(language or "").strip().lower()
    if key == "multilingual":
        return SPEECH_THERAPY_TASKS
    return [task for task in SPEECH_THERAPY_TASKS if task.language.lower() == key] or SPEECH_THERAPY_TASKS


def relative_audio_path(path: str | Path, root: str | Path) -> str:
    return os.path.relpath(Path(path), Path(root))
