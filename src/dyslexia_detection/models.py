from __future__ import annotations

import torch
from torch import nn

from .config import DataConfig
from .preprocessing import build_char_vocab


class HandwritingEncoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Dropout2d(0.05),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Dropout2d(0.08),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 96, kernel_size=3, padding=1),
            nn.BatchNorm2d(96),
            nn.ReLU(inplace=True),
            nn.Dropout2d(0.1),
            nn.AdaptiveAvgPool2d((1, 1)),
        )
        self.projection = nn.Sequential(
            nn.Linear(96, 64),
            nn.LayerNorm(64),
            nn.GELU(),
        )

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        x = self.features(image).flatten(1)
        return self.projection(x)


class AudioEncoder(nn.Module):
    def __init__(self, config: DataConfig):
        super().__init__()
        self.network = nn.Sequential(
            nn.Conv1d(config.n_mfcc, 64, kernel_size=5, padding=2),
            nn.BatchNorm1d(64),
            nn.GELU(),
            nn.Dropout(0.05),
            nn.MaxPool1d(2),
            nn.Conv1d(64, 96, kernel_size=3, padding=1),
            nn.BatchNorm1d(96),
            nn.GELU(),
            nn.Dropout(0.08),
            nn.Conv1d(96, 96, kernel_size=3, padding=1),
            nn.BatchNorm1d(96),
            nn.GELU(),
            nn.AdaptiveAvgPool1d(1),
        )
        self.projection = nn.Sequential(
            nn.Linear(96, 64),
            nn.LayerNorm(64),
            nn.GELU(),
        )

    def forward(self, audio: torch.Tensor) -> torch.Tensor:
        return self.projection(self.network(audio).flatten(1))


class TextEncoder(nn.Module):
    def __init__(self, vocab_size: int, embedding_dim: int = 96, hidden_dim: int = 96):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim, padding_idx=0)
        self.embedding_dropout = nn.Dropout(0.08)
        self.sequence = nn.GRU(
            embedding_dim,
            hidden_dim,
            batch_first=True,
            bidirectional=True,
            dropout=0.05,
        )
        self.projection = nn.Sequential(
            nn.Linear(hidden_dim * 2, 64),
            nn.LayerNorm(64),
            nn.GELU(),
        )

    def forward(self, text: torch.Tensor) -> torch.Tensor:
        embedded = self.embedding_dropout(self.embedding(text))
        _, hidden = self.sequence(embedded)
        combined = torch.cat([hidden[-2], hidden[-1]], dim=1)
        return self.projection(combined)


class LSTMTextEncoder(nn.Module):
    def __init__(self, vocab_size: int, embedding_dim: int = 96, hidden_dim: int = 96):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim, padding_idx=0)
        self.embedding_dropout = nn.Dropout(0.08)
        self.sequence = nn.LSTM(
            embedding_dim,
            hidden_dim,
            batch_first=True,
            bidirectional=True,
            dropout=0.05,
        )
        self.projection = nn.Sequential(
            nn.Linear(hidden_dim * 2, 64),
            nn.LayerNorm(64),
            nn.GELU(),
        )

    def forward(self, text: torch.Tensor) -> torch.Tensor:
        embedded = self.embedding_dropout(self.embedding(text))
        _, (hidden, _) = self.sequence(embedded)
        combined = torch.cat([hidden[-2], hidden[-1]], dim=1)
        return self.projection(combined)


class TransformerTextEncoder(nn.Module):
    def __init__(
        self,
        vocab_size: int,
        max_length: int,
        embedding_dim: int = 80,
        num_heads: int = 4,
        num_layers: int = 1,
    ):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim, padding_idx=0)
        self.position = nn.Parameter(torch.zeros(1, max_length, embedding_dim))
        layer = nn.TransformerEncoderLayer(
            d_model=embedding_dim,
            nhead=num_heads,
            dim_feedforward=96,
            dropout=0.16,
            batch_first=True,
            activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=num_layers, enable_nested_tensor=False)
        self.projection = nn.Sequential(
            nn.Linear(embedding_dim, 64),
            nn.LayerNorm(64),
            nn.GELU(),
        )

    def forward(self, text: torch.Tensor) -> torch.Tensor:
        mask = text.eq(0)
        embedded = self.embedding(text) + self.position[:, : text.shape[1]]
        encoded = self.encoder(embedded, src_key_padding_mask=mask)
        valid = (~mask).unsqueeze(-1).float()
        pooled = (encoded * valid).sum(dim=1) / valid.sum(dim=1).clamp_min(1.0)
        return self.projection(pooled)


class ViTHandwritingEncoder(nn.Module):
    def __init__(
        self,
        image_size: int = 128,
        patch_size: int = 16,
        embedding_dim: int = 96,
        num_heads: int = 6,
        num_layers: int = 3,
    ):
        super().__init__()
        if image_size % patch_size != 0:
            raise ValueError("image_size must be divisible by patch_size")
        num_patches = (image_size // patch_size) ** 2
        self.patch = nn.Conv2d(1, embedding_dim, kernel_size=patch_size, stride=patch_size)
        self.cls_token = nn.Parameter(torch.zeros(1, 1, embedding_dim))
        self.position = nn.Parameter(torch.zeros(1, num_patches + 1, embedding_dim))
        layer = nn.TransformerEncoderLayer(
            d_model=embedding_dim,
            nhead=num_heads,
            dim_feedforward=192,
            dropout=0.08,
            batch_first=True,
            activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=num_layers)
        self.projection = nn.Sequential(
            nn.Linear(embedding_dim, 64),
            nn.LayerNorm(64),
            nn.GELU(),
        )

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        patches = self.patch(image).flatten(2).transpose(1, 2)
        cls = self.cls_token.expand(image.shape[0], -1, -1)
        tokens = torch.cat([cls, patches], dim=1) + self.position
        encoded = self.encoder(tokens)
        return self.projection(encoded[:, 0])


class BehaviorEncoder(nn.Module):
    def __init__(self, input_dim: int = 4):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_dim, 32),
            nn.LayerNorm(32),
            nn.GELU(),
            nn.Dropout(0.05),
            nn.Linear(32, 32),
            nn.LayerNorm(32),
            nn.GELU(),
        )

    def forward(self, behavior: torch.Tensor) -> torch.Tensor:
        return self.network(behavior)


class FusionClassifier(nn.Module):
    def __init__(
        self,
        handwriting: nn.Module,
        audio: nn.Module,
        text: nn.Module,
        behavior: nn.Module,
        num_classes: int = 2,
        hidden_dim: int = 192,
        dropout: float = 0.3,
        modality_dropout: float = 0.1,
    ):
        super().__init__()
        self.handwriting = handwriting
        self.audio = audio
        self.text = text
        self.behavior = behavior
        self.modality_dropout = float(modality_dropout)
        self.fused_feature_dim = 64 + 64 + 64 + 32 + 2
        self.fusion_norm = nn.LayerNorm(self.fused_feature_dim)
        self.classifier = nn.Sequential(
            nn.Linear(self.fused_feature_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, 96),
            nn.LayerNorm(96),
            nn.GELU(),
            nn.Dropout(dropout * 0.75),
            nn.Linear(96, num_classes),
        )

    def encode_modalities(
        self,
        image: torch.Tensor,
        audio: torch.Tensor,
        text: torch.Tensor,
        errors: torch.Tensor,
        behavior: torch.Tensor | None = None,
    ) -> dict[str, torch.Tensor]:
        if behavior is None:
            behavior = torch.zeros((image.shape[0], 4), dtype=image.dtype, device=image.device)
        return {
            "handwriting_features": self.handwriting(image),
            "audio_features": self.audio(audio),
            "text_sequence_features": self.text(text),
            "behavior_features": self.behavior(behavior),
            "error_features": errors,
        }

    def fuse_features(self, features: dict[str, torch.Tensor]) -> torch.Tensor:
        fused = torch.cat(
            [
                features["handwriting_features"],
                features["audio_features"],
                features["text_sequence_features"],
                features["behavior_features"],
                features["error_features"],
            ],
            dim=1,
        )
        return self.fusion_norm(fused)

    def _apply_modality_dropout(self, features: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
        if not self.training or self.modality_dropout <= 0:
            return features
        dropped = dict(features)
        for key in ["handwriting_features", "audio_features", "text_sequence_features", "behavior_features"]:
            if torch.rand(1, device=features[key].device).item() < self.modality_dropout:
                dropped[key] = torch.zeros_like(features[key])
        return dropped

    def forward(
        self,
        image: torch.Tensor,
        audio: torch.Tensor,
        text: torch.Tensor,
        errors: torch.Tensor,
        behavior: torch.Tensor | None = None,
    ) -> torch.Tensor:
        features = self.encode_modalities(image, audio, text, errors, behavior)
        features = self._apply_modality_dropout(features)
        return self.classifier(self.fuse_features(features))


class AttentionFusionClassifier(FusionClassifier):
    def __init__(
        self,
        handwriting: nn.Module,
        audio: nn.Module,
        text: nn.Module,
        behavior: nn.Module,
        num_classes: int = 2,
        hidden_dim: int = 128,
        dropout: float = 0.25,
        modality_dropout: float = 0.1,
    ):
        super().__init__(
            handwriting=handwriting,
            audio=audio,
            text=text,
            behavior=behavior,
            num_classes=num_classes,
            hidden_dim=hidden_dim,
            dropout=dropout,
            modality_dropout=modality_dropout,
        )
        self.modality_project = nn.ModuleDict(
            {
                "handwriting_features": nn.Linear(64, 64),
                "audio_features": nn.Linear(64, 64),
                "text_sequence_features": nn.Linear(64, 64),
                "behavior_features": nn.Linear(32, 64),
            }
        )
        self.attention_score = nn.ModuleDict(
            {
                "handwriting_features": nn.Sequential(nn.Linear(64, 32), nn.GELU(), nn.Linear(32, 1)),
                "audio_features": nn.Sequential(nn.Linear(64, 32), nn.GELU(), nn.Linear(32, 1)),
                "text_sequence_features": nn.Sequential(nn.Linear(64, 32), nn.GELU(), nn.Linear(32, 1)),
                "behavior_features": nn.Sequential(nn.Linear(64, 32), nn.GELU(), nn.Linear(32, 1)),
            }
        )
        self.classifier = nn.Sequential(
            nn.Linear(64 + 2, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, 64),
            nn.LayerNorm(64),
            nn.GELU(),
            nn.Linear(64, num_classes),
        )
        self.last_modality_attention: dict[str, torch.Tensor] | None = None

    def modality_attention(self, features: dict[str, torch.Tensor]) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
        projected = {
            key: self.modality_project[key](features[key])
            for key in ["handwriting_features", "audio_features", "text_sequence_features", "behavior_features"]
        }
        scores = torch.cat(
            [
                self.attention_score["handwriting_features"](projected["handwriting_features"]),
                self.attention_score["audio_features"](projected["audio_features"]),
                self.attention_score["text_sequence_features"](projected["text_sequence_features"]),
                self.attention_score["behavior_features"](projected["behavior_features"]),
            ],
            dim=1,
        )
        weights = torch.softmax(scores, dim=1)
        fused = (
            projected["handwriting_features"] * weights[:, 0:1]
            + projected["audio_features"] * weights[:, 1:2]
            + projected["text_sequence_features"] * weights[:, 2:3]
            + projected["behavior_features"] * weights[:, 3:4]
        )
        attention = {
            "handwriting": weights[:, 0],
            "speech": weights[:, 1],
            "text": weights[:, 2],
            "reading_behavior": weights[:, 3],
        }
        return fused, attention

    def forward(
        self,
        image: torch.Tensor,
        audio: torch.Tensor,
        text: torch.Tensor,
        errors: torch.Tensor,
        behavior: torch.Tensor | None = None,
    ) -> torch.Tensor:
        features = self.encode_modalities(image, audio, text, errors, behavior)
        features = self._apply_modality_dropout(features)
        fused, attention = self.modality_attention(features)
        self.last_modality_attention = attention
        classifier_input = torch.cat([fused, features["error_features"]], dim=1)
        return self.classifier(classifier_input)


class MultimodalDyslexiaModel(FusionClassifier):
    def __init__(self, config: DataConfig | None = None, num_classes: int = 2):
        self.config = config or DataConfig()
        vocab_size = len(build_char_vocab(getattr(self.config, "text_language", "bengali")))
        super().__init__(
            handwriting=HandwritingEncoder(),
            audio=AudioEncoder(self.config),
            text=TextEncoder(vocab_size=vocab_size),
            behavior=BehaviorEncoder(),
            num_classes=num_classes,
        )


class TransformerMultimodalModel(FusionClassifier):
    def __init__(self, config: DataConfig | None = None, num_classes: int = 2):
        self.config = config or DataConfig()
        vocab_size = len(build_char_vocab(getattr(self.config, "text_language", "bengali")))
        super().__init__(
            handwriting=HandwritingEncoder(),
            audio=AudioEncoder(self.config),
            text=TransformerTextEncoder(vocab_size=vocab_size, max_length=self.config.max_text_length),
            behavior=BehaviorEncoder(),
            num_classes=num_classes,
            hidden_dim=144,
            dropout=0.45,
            modality_dropout=0.25,
        )


class ViTMultimodalModel(FusionClassifier):
    def __init__(self, config: DataConfig | None = None, num_classes: int = 2):
        self.config = config or DataConfig()
        vocab_size = len(build_char_vocab(getattr(self.config, "text_language", "bengali")))
        super().__init__(
            handwriting=ViTHandwritingEncoder(image_size=self.config.image_size),
            audio=AudioEncoder(self.config),
            text=TextEncoder(vocab_size=vocab_size),
            behavior=BehaviorEncoder(),
            num_classes=num_classes,
            hidden_dim=224,
            dropout=0.22,
            modality_dropout=0.05,
        )


class ViTTransformerMultimodalModel(FusionClassifier):
    def __init__(self, config: DataConfig | None = None, num_classes: int = 2):
        self.config = config or DataConfig()
        vocab_size = len(build_char_vocab(getattr(self.config, "text_language", "bengali")))
        super().__init__(
            handwriting=ViTHandwritingEncoder(image_size=self.config.image_size),
            audio=AudioEncoder(self.config),
            text=TransformerTextEncoder(vocab_size=vocab_size, max_length=self.config.max_text_length),
            behavior=BehaviorEncoder(),
            num_classes=num_classes,
        )


class AttentionMultimodalModel(AttentionFusionClassifier):
    def __init__(self, config: DataConfig | None = None, num_classes: int = 2):
        self.config = config or DataConfig()
        vocab_size = len(build_char_vocab(getattr(self.config, "text_language", "bengali")))
        super().__init__(
            handwriting=ViTHandwritingEncoder(image_size=self.config.image_size),
            audio=AudioEncoder(self.config),
            text=TransformerTextEncoder(vocab_size=vocab_size, max_length=self.config.max_text_length, embedding_dim=96, num_layers=2),
            behavior=BehaviorEncoder(),
            num_classes=num_classes,
            hidden_dim=192,
            dropout=0.22,
            modality_dropout=0.1,
        )


class InitialCNNLSTMModel(nn.Module):
    def __init__(self, config: DataConfig | None = None, num_classes: int = 2):
        super().__init__()
        self.config = config or DataConfig()
        vocab_size = len(build_char_vocab(getattr(self.config, "text_language", "bengali")))
        self.handwriting = HandwritingEncoder()
        self.audio = AudioEncoder(self.config)
        self.text = LSTMTextEncoder(vocab_size=vocab_size)
        self.behavior = BehaviorEncoder()
        self.fused_feature_dim = 64 + 64 + 64 + 32 + 2
        self.classifier = nn.Sequential(
            nn.Linear(self.fused_feature_dim, 128),
            nn.LayerNorm(128),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(128, num_classes),
        )

    def encode_modalities(
        self,
        image: torch.Tensor,
        audio: torch.Tensor,
        text: torch.Tensor,
        errors: torch.Tensor,
        behavior: torch.Tensor | None = None,
    ) -> dict[str, torch.Tensor]:
        if behavior is None:
            behavior = torch.zeros((image.shape[0], 4), dtype=image.dtype, device=image.device)
        return {
            "handwriting_features": self.handwriting(image),
            "audio_features": self.audio(audio),
            "text_sequence_features": self.text(text),
            "behavior_features": self.behavior(behavior),
            "error_features": errors,
        }

    def fuse_features(self, features: dict[str, torch.Tensor]) -> torch.Tensor:
        return torch.cat(
            [
                features["handwriting_features"],
                features["audio_features"],
                features["text_sequence_features"],
                features["behavior_features"],
                features["error_features"],
            ],
            dim=1,
        )

    def forward(
        self,
        image: torch.Tensor,
        audio: torch.Tensor,
        text: torch.Tensor,
        errors: torch.Tensor,
        behavior: torch.Tensor | None = None,
    ) -> torch.Tensor:
        features = self.encode_modalities(image, audio, text, errors, behavior)
        return self.classifier(self.fuse_features(features))


def build_model(model_name: str, config: DataConfig | None = None, num_classes: int = 2) -> nn.Module:
    if model_name == "cnn_lstm":
        return InitialCNNLSTMModel(config, num_classes=num_classes)
    if model_name == "transformer":
        return TransformerMultimodalModel(config, num_classes=num_classes)
    if model_name == "vit":
        return ViTMultimodalModel(config, num_classes=num_classes)
    if model_name == "vit_transformer":
        return ViTTransformerMultimodalModel(config, num_classes=num_classes)
    if model_name == "multimodal":
        return MultimodalDyslexiaModel(config, num_classes=num_classes)
    if model_name == "multimodal_attention":
        return AttentionMultimodalModel(config, num_classes=num_classes)
    raise ValueError(f"Unknown model name: {model_name}")
