from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import json

import pandas as pd


SEVERITY_NAME_TO_LEVEL = {
    "low risk": 0,
    "mild": 0,
    "elevated risk": 1,
    "moderate": 1,
    "severe": 2,
}


@dataclass(frozen=True)
class InterventionProfile:
    language: str
    severity_level: int
    spelling_errors: int
    pronunciation_errors: int
    reading_time_seconds: float
    hesitation_count: int
    repetition_count: int
    omission_count: int

    def state_key(self) -> str:
        effort = 0 if self.reading_time_seconds < 25 else 1 if self.reading_time_seconds < 45 else 2
        total_disfluency = self.hesitation_count + self.repetition_count + self.omission_count
        disfluency = 0 if total_disfluency <= 2 else 1 if total_disfluency <= 5 else 2
        return f"{self.language.lower()}|s{self.severity_level}|e{effort}|d{disfluency}"


def _reading_bank(language: str) -> list[str]:
    base = {
        "bengali": [
            "Letter tracking with syllable tapping",
            "Two-word chunk reading with pacing",
            "Short sentence repeated reading",
            "Timed paragraph fluency with teacher echo",
        ],
        "english": [
            "Phonics blending with finger tracking",
            "Two-word chunk reading with pacing",
            "Short sentence repeated reading",
            "Timed paragraph fluency with teacher echo",
        ],
        "multilingual": [
            "Cross-script letter mapping drills",
            "Mixed-language chunk reading",
            "Short sentence repeated reading",
            "Timed paragraph fluency with teacher echo",
        ],
    }
    return base.get(language.lower(), base["bengali"])


def _pronunciation_bank(language: str) -> list[str]:
    base = {
        "bengali": [
            "Minimal-pair Bengali articulation drills",
            "Syllable elongation and stress control",
            "Phrase imitation with slowed playback",
            "Recorded self-monitoring and correction loop",
        ],
        "english": [
            "Minimal-pair phoneme contrast drills",
            "Syllable elongation and stress control",
            "Phrase imitation with slowed playback",
            "Recorded self-monitoring and correction loop",
        ],
        "multilingual": [
            "Cross-language sound contrast drills",
            "Syllable elongation and stress control",
            "Phrase imitation with slowed playback",
            "Recorded self-monitoring and correction loop",
        ],
    }
    return base.get(language.lower(), base["bengali"])


def _spelling_bank(language: str) -> list[str]:
    base = {
        "bengali": [
            "Grapheme-phoneme mapping dictation",
            "Error-word copy and cover spelling cycle",
            "Syllable segmentation and reconstruction",
            "Sentence dictation with immediate correction",
        ],
        "english": [
            "Phoneme-grapheme mapping dictation",
            "Error-word copy and cover spelling cycle",
            "Syllable segmentation and reconstruction",
            "Sentence dictation with immediate correction",
        ],
        "multilingual": [
            "Cross-script grapheme mapping dictation",
            "Error-word copy and cover spelling cycle",
            "Syllable segmentation and reconstruction",
            "Sentence dictation with immediate correction",
        ],
    }
    return base.get(language.lower(), base["bengali"])


def _default_action(profile: InterventionProfile) -> str:
    score = profile.severity_level + (1 if profile.pronunciation_errors >= 3 else 0) + (1 if profile.spelling_errors >= 3 else 0)
    if score <= 1:
        return "balanced_foundation"
    if score == 2:
        return "pronunciation_focus"
    if score == 3:
        return "spelling_focus"
    return "intensive_mixed"


def _action_to_indices(action: str) -> tuple[int, int, int]:
    mapping = {
        "balanced_foundation": (1, 1, 1),
        "pronunciation_focus": (1, 2, 1),
        "spelling_focus": (1, 1, 2),
        "reading_fluency_focus": (2, 1, 1),
        "intensive_mixed": (3, 3, 3),
    }
    return mapping.get(action, (1, 1, 1))


class InterventionPolicy:
    def __init__(self, actions: list[str] | None = None):
        self.actions = actions or [
            "balanced_foundation",
            "pronunciation_focus",
            "spelling_focus",
            "reading_fluency_focus",
            "intensive_mixed",
        ]
        self.q_table: dict[str, dict[str, float]] = {}
        self.alpha = 0.25
        self.gamma = 0.9

    def _ensure(self, state_key: str) -> dict[str, float]:
        if state_key not in self.q_table:
            self.q_table[state_key] = {action: 0.0 for action in self.actions}
        return self.q_table[state_key]

    def choose_action(self, profile: InterventionProfile) -> str:
        state_key = profile.state_key()
        values = self._ensure(state_key)
        if max(values.values()) == 0.0:
            return _default_action(profile)
        best_value = max(values.values())
        best_actions = [action for action, value in values.items() if value == best_value]
        return sorted(best_actions)[0]

    def update(self, state_key: str, action: str, reward: float, next_state_key: str) -> None:
        current = self._ensure(state_key)
        future = self._ensure(next_state_key)
        q = current[action]
        target = reward + self.gamma * max(future.values())
        current[action] = q + self.alpha * (target - q)

    def save(self, path: str | Path) -> Path:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps({"actions": self.actions, "q_table": self.q_table, "alpha": self.alpha, "gamma": self.gamma}, indent=2),
            encoding="utf-8",
        )
        return output

    @classmethod
    def load_or_create(cls, path: str | Path) -> "InterventionPolicy":
        policy_path = Path(path)
        if not policy_path.exists():
            return cls()
        payload = json.loads(policy_path.read_text(encoding="utf-8"))
        policy = cls(actions=payload.get("actions") or None)
        policy.alpha = float(payload.get("alpha", 0.25))
        policy.gamma = float(payload.get("gamma", 0.9))
        q_table = payload.get("q_table", {})
        for key, value in q_table.items():
            policy.q_table[key] = {action: float(score) for action, score in value.items()}
        return policy


@dataclass(frozen=True)
class InterventionPlan:
    action: str
    reading_exercise: str
    pronunciation_exercise: str
    spelling_exercise: str
    weekly_target_minutes: int
    notes: str


def build_intervention_plan(profile: InterventionProfile, policy: InterventionPolicy) -> InterventionPlan:
    action = policy.choose_action(profile)
    read_idx, pron_idx, spell_idx = _action_to_indices(action)
    reading = _reading_bank(profile.language)[min(read_idx, 3)]
    pronunciation = _pronunciation_bank(profile.language)[min(pron_idx, 3)]
    spelling = _spelling_bank(profile.language)[min(spell_idx, 3)]
    minutes = 45 if profile.severity_level == 0 else 70 if profile.severity_level == 1 else 95
    if action == "intensive_mixed":
        minutes += 15
    notes = (
        "Use short sessions with frequent feedback and record weekly progress. "
        "Adjust complexity when hesitations and substitutions decrease for two consecutive sessions."
    )
    return InterventionPlan(
        action=action,
        reading_exercise=reading,
        pronunciation_exercise=pronunciation,
        spelling_exercise=spelling,
        weekly_target_minutes=minutes,
        notes=notes,
    )


def reward_from_progress(
    reading_time_seconds: float,
    hesitation_count: int,
    repetition_count: int,
    omission_count: int,
    pronunciation_errors: int,
    spelling_errors: int,
) -> float:
    penalty = (
        min(reading_time_seconds / 120.0, 1.0)
        + hesitation_count * 0.08
        + repetition_count * 0.07
        + omission_count * 0.1
        + pronunciation_errors * 0.08
        + spelling_errors * 0.08
    )
    return round(max(-1.0, 1.0 - penalty), 3)


def append_intervention_log(path: str | Path, row: dict[str, object]) -> Path:
    columns = [
        "timestamp",
        "student_hash",
        "language",
        "state",
        "action",
        "severity_level",
        "reading_exercise",
        "pronunciation_exercise",
        "spelling_exercise",
        "weekly_target_minutes",
    ]
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        frame = pd.read_csv(output)
    else:
        frame = pd.DataFrame(columns=columns)
    for column in columns:
        if column not in frame:
            frame[column] = ""
    normalized = {column: row.get(column, "") for column in columns}
    if not normalized["timestamp"]:
        normalized["timestamp"] = datetime.now().isoformat(timespec="seconds")
    row_frame = pd.DataFrame([normalized], columns=columns)
    if frame.empty:
        updated = row_frame
    else:
        updated = pd.concat([frame[columns], row_frame], ignore_index=True)
    updated.to_csv(output, index=False)
    return output
