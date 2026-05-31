from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import json
import random

import pandas as pd


@dataclass(frozen=True)
class TutorState:
    language: str
    fluency_bin: int
    error_bin: int

    def key(self) -> str:
        return f"{self.language.lower()}|f{self.fluency_bin}|e{self.error_bin}"


def build_state(
    language: str,
    reading_time_seconds: float,
    hesitations: int,
    repetitions: int,
    omissions: int,
) -> TutorState:
    fluency_load = min(reading_time_seconds / 60.0, 3.0)
    error_load = hesitations + repetitions + omissions
    fluency_bin = 0 if fluency_load < 0.8 else 1 if fluency_load < 1.6 else 2
    error_bin = 0 if error_load <= 2 else 1 if error_load <= 5 else 2
    return TutorState(language=language, fluency_bin=fluency_bin, error_bin=error_bin)


def compute_reward(reading_time_seconds: float, hesitations: int, repetitions: int, omissions: int) -> float:
    penalty = min(reading_time_seconds / 120.0, 1.0) + (hesitations * 0.12) + (repetitions * 0.1) + (omissions * 0.15)
    return round(max(-1.0, 1.0 - penalty), 3)


class AdaptiveTutorAgent:
    def __init__(self, actions: list[str], alpha: float = 0.25, gamma: float = 0.9, epsilon: float = 0.15):
        if not actions:
            raise ValueError("actions must not be empty")
        self.actions = actions
        self.alpha = float(alpha)
        self.gamma = float(gamma)
        self.epsilon = float(epsilon)
        self.q_table: dict[str, dict[str, float]] = {}

    def _ensure_state(self, state: TutorState) -> dict[str, float]:
        key = state.key()
        if key not in self.q_table:
            self.q_table[key] = {action: 0.0 for action in self.actions}
        for action in self.actions:
            self.q_table[key].setdefault(action, 0.0)
        return self.q_table[key]

    def select_action(self, state: TutorState, explore: bool = True) -> str:
        values = self._ensure_state(state)
        if explore and random.random() < self.epsilon:
            return random.choice(self.actions)
        max_value = max(values.values())
        best = [action for action, value in values.items() if value == max_value]
        return sorted(best)[0]

    def update(self, state: TutorState, action: str, reward: float, next_state: TutorState) -> None:
        current_values = self._ensure_state(state)
        next_values = self._ensure_state(next_state)
        current_q = current_values[action]
        target = reward + self.gamma * max(next_values.values())
        current_values[action] = current_q + self.alpha * (target - current_q)

    def export_rows(self) -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for state_key, values in self.q_table.items():
            for action, q_value in values.items():
                rows.append({"state": state_key, "action": action, "q_value": round(q_value, 6)})
        return rows

    def save(self, path: str | Path) -> Path:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(
                {
                    "actions": self.actions,
                    "alpha": self.alpha,
                    "gamma": self.gamma,
                    "epsilon": self.epsilon,
                    "q_table": self.q_table,
                },
                ensure_ascii=True,
                indent=2,
            ),
            encoding="utf-8",
        )
        return output

    @classmethod
    def load_or_create(cls, path: str | Path, actions: list[str]) -> "AdaptiveTutorAgent":
        policy_path = Path(path)
        if not policy_path.exists():
            return cls(actions=actions)
        payload = json.loads(policy_path.read_text(encoding="utf-8"))
        agent = cls(
            actions=actions,
            alpha=float(payload.get("alpha", 0.25)),
            gamma=float(payload.get("gamma", 0.9)),
            epsilon=float(payload.get("epsilon", 0.15)),
        )
        loaded = payload.get("q_table", {})
        for state_key, values in loaded.items():
            agent.q_table[state_key] = {action: float(values.get(action, 0.0)) for action in actions}
        return agent


def append_tutoring_event(log_path: str | Path, row: dict[str, object]) -> Path:
    columns = [
        "timestamp",
        "language",
        "state",
        "action",
        "reward",
        "reading_time_seconds",
        "hesitations",
        "repetitions",
        "omissions",
    ]
    output = Path(log_path)
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
