from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from .config import DataConfig
from .models import MultimodalDyslexiaModel
from .preprocessing import build_char_vocab, encode_text, extract_audio_features, load_handwriting_image
from .schemas import BEHAVIOR_COLUMNS


@dataclass(frozen=True)
class RawInput:
    handwriting_path: Path | None
    audio_path: Path | None
    text_sample: str
    spelling_errors: int
    pronunciation_errors: int
    reading_time_seconds: float
    hesitation_count: int
    repetition_count: int
    omission_count: int
    language: str = "bengali"


@dataclass(frozen=True)
class PreprocessedInput:
    image: torch.Tensor
    audio: torch.Tensor
    text: torch.Tensor
    errors: torch.Tensor
    behavior: torch.Tensor


class ScreeningPipeline:
    def __init__(self, model: MultimodalDyslexiaModel, config: DataConfig | None = None):
        self.model = model.eval()
        self.config = config or DataConfig()
        self.text_language = getattr(self.config, "text_language", "bengali")
        self.vocab = build_char_vocab(self.text_language)

    def input_layer(self, manifest_path: str | Path, sample_id: str) -> RawInput:
        manifest = Path(manifest_path)
        frame = pd.read_csv(manifest)
        row = frame.loc[frame["sample_id"].astype(str) == str(sample_id)]
        if row.empty:
            raise ValueError(f"Sample not found: {sample_id}")
        return self._row_to_input(manifest.parent, row.iloc[0])

    def preprocessing_layer(self, raw: RawInput) -> PreprocessedInput:
        image = torch.tensor(load_handwriting_image(raw.handwriting_path, self.config), dtype=torch.float32).unsqueeze(0)
        audio = torch.tensor(extract_audio_features(raw.audio_path, self.config), dtype=torch.float32).unsqueeze(0)
        text = torch.tensor(
            encode_text(raw.text_sample, self.vocab, self.config.max_text_length, raw.language),
            dtype=torch.long,
        ).unsqueeze(0)
        errors = torch.tensor([[raw.spelling_errors, raw.pronunciation_errors]], dtype=torch.float32)
        behavior = torch.tensor(
            [[raw.reading_time_seconds, raw.hesitation_count, raw.repetition_count, raw.omission_count]],
            dtype=torch.float32,
        )
        return PreprocessedInput(image=image, audio=audio, text=text, errors=errors, behavior=behavior)

    def feature_extraction_layer(self, preprocessed: PreprocessedInput) -> dict[str, torch.Tensor]:
        with torch.no_grad():
            return {
                "handwriting_features": self.model.handwriting(preprocessed.image),
                "audio_features": self.model.audio(preprocessed.audio),
                "behavior_features": self.model.behavior(preprocessed.behavior),
                "error_features": preprocessed.errors,
            }

    def sequence_modeling_layer(self, preprocessed: PreprocessedInput) -> dict[str, torch.Tensor]:
        with torch.no_grad():
            return {"text_sequence_features": self.model.text(preprocessed.text)}

    def classification_layer(self, features: dict[str, torch.Tensor]) -> dict[str, object]:
        with torch.no_grad():
            fused = self.model.fuse_features(features)
            logits = self.model.classifier(fused)
            probabilities = torch.softmax(logits, dim=1).squeeze(0).numpy()
        return {
            "fused_feature_shape": tuple(fused.shape),
            "logits": logits.squeeze(0).numpy(),
            "probabilities": probabilities,
            "predicted_label": int(np.argmax(probabilities)),
            "confidence": float(np.max(probabilities)),
        }

    def run(self, manifest_path: str | Path, sample_id: str) -> dict[str, object]:
        raw = self.input_layer(manifest_path, sample_id)
        preprocessed = self.preprocessing_layer(raw)
        extracted = self.feature_extraction_layer(preprocessed)
        sequenced = self.sequence_modeling_layer(preprocessed)
        features = {**extracted, **sequenced}
        classification = self.classification_layer(features)
        return {
            "input_layer": raw,
            "preprocessing_layer": {
                "image_shape": tuple(preprocessed.image.shape),
                "audio_shape": tuple(preprocessed.audio.shape),
                "text_shape": tuple(preprocessed.text.shape),
                "errors_shape": tuple(preprocessed.errors.shape),
                "behavior_shape": tuple(preprocessed.behavior.shape),
            },
            "feature_extraction_layer": {key: tuple(value.shape) for key, value in extracted.items()},
            "sequence_modeling_layer": {key: tuple(value.shape) for key, value in sequenced.items()},
            "classification_layer": classification,
        }

    def _row_to_input(self, root: Path, row: pd.Series) -> RawInput:
        def resolve(value: object) -> Path | None:
            if pd.isna(value) or not str(value).strip():
                return None
            path = Path(str(value))
            return path if path.is_absolute() else root / path

        behavior_values = {
            column: float(row[column]) if column in row and not pd.isna(row[column]) else 0.0
            for column in BEHAVIOR_COLUMNS
        }
        return RawInput(
            handwriting_path=resolve(row["handwriting_path"]),
            audio_path=resolve(row["audio_path"]),
            text_sample=str(row["text_sample"]),
            spelling_errors=int(row["spelling_errors"]),
            pronunciation_errors=int(row["pronunciation_errors"]),
            reading_time_seconds=behavior_values["reading_time_seconds"],
            hesitation_count=int(behavior_values["hesitation_count"]),
            repetition_count=int(behavior_values["repetition_count"]),
            omission_count=int(behavior_values["omission_count"]),
            language=str(row["language"]) if "language" in row and not pd.isna(row["language"]) else self.text_language,
        )
