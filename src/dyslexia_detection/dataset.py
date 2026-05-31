from __future__ import annotations

from pathlib import Path

import pandas as pd
import torch
from torch.utils.data import Dataset

from .config import DataConfig
from .preprocessing import build_char_vocab, encode_text, extract_audio_features, load_handwriting_image
from .severity import derive_severity_targets
from .schemas import BEHAVIOR_COLUMNS, REQUIRED_MANIFEST_COLUMNS


class DyslexiaManifestDataset(Dataset):
    def __init__(self, manifest_path: str | Path, config: DataConfig | None = None):
        self.manifest_path = Path(manifest_path)
        self.root = self.manifest_path.parent
        self.config = config or DataConfig()
        self.text_language = getattr(self.config, "text_language", "bengali")
        self.vocab = build_char_vocab(self.text_language)
        self.frame = pd.read_csv(self.manifest_path)
        missing = REQUIRED_MANIFEST_COLUMNS.difference(self.frame.columns)
        if missing:
            raise ValueError(f"Manifest is missing required columns: {sorted(missing)}")

    def __len__(self) -> int:
        return len(self.frame)

    def _resolve_path(self, value: object) -> Path | None:
        if pd.isna(value) or not str(value).strip():
            return None
        path = Path(str(value))
        if path.is_absolute():
            return path
        return (self.root / path).resolve()

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        row = self.frame.iloc[index]
        image = load_handwriting_image(self._resolve_path(row["handwriting_path"]), self.config)
        audio = extract_audio_features(self._resolve_path(row["audio_path"]), self.config)
        language = str(row["language"]) if "language" in self.frame.columns and not pd.isna(row["language"]) else self.text_language
        text = encode_text(str(row["text_sample"]), self.vocab, self.config.max_text_length, language)
        errors = [float(row["spelling_errors"]), float(row["pronunciation_errors"])]
        behavior = [float(row[column]) if column in self.frame.columns and not pd.isna(row[column]) else 0.0 for column in BEHAVIOR_COLUMNS]
        severity_label, severity_score = derive_severity_targets(row)

        return {
            "image": torch.tensor(image, dtype=torch.float32),
            "audio": torch.tensor(audio, dtype=torch.float32),
            "text": torch.tensor(text, dtype=torch.long),
            "errors": torch.tensor(errors, dtype=torch.float32),
            "behavior": torch.tensor(behavior, dtype=torch.float32),
            "label": torch.tensor(int(row["label"]), dtype=torch.long),
            "severity_label": torch.tensor(int(severity_label), dtype=torch.long),
            "severity_score": torch.tensor(float(severity_score), dtype=torch.float32),
        }
