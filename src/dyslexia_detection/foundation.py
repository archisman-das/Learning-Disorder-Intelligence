from __future__ import annotations

from dataclasses import dataclass

import torch
import torch.nn.functional as F
from torch import nn

from .config import DataConfig
from .models import AudioEncoder, BehaviorEncoder, HandwritingEncoder, TransformerTextEncoder
from .preprocessing import build_char_vocab


@dataclass(frozen=True)
class FoundationConfig:
    projection_dim: int = 128
    hidden_dim: int = 192
    temperature: float = 0.07
    text_mask_probability: float = 0.15
    reconstruction_weight: float = 0.2
    text_weight: float = 0.4
    contrastive_weight: float = 1.0


def random_text_mask(text: torch.Tensor, pad_id: int = 0, mask_probability: float = 0.15) -> tuple[torch.Tensor, torch.Tensor]:
    valid = text.ne(pad_id)
    mask = (torch.rand_like(text.float()) < mask_probability) & valid
    masked = text.clone()
    masked[mask] = pad_id
    return masked, mask


class BengaliLearningDisorderFoundationModel(nn.Module):
    """Multimodal foundation model reusable across dyslexia/dysgraphia/dyscalculia tasks."""

    def __init__(self, data_config: DataConfig | None = None, cfg: FoundationConfig | None = None):
        super().__init__()
        self.data_config = data_config or DataConfig()
        self.cfg = cfg or FoundationConfig()
        vocab_size = len(build_char_vocab(getattr(self.data_config, "text_language", "bengali")))

        self.handwriting = HandwritingEncoder()
        self.audio = AudioEncoder(self.data_config)
        self.text = TransformerTextEncoder(vocab_size=vocab_size, max_length=self.data_config.max_text_length)
        self.behavior = BehaviorEncoder()

        self.modality_projectors = nn.ModuleDict(
            {
                "handwriting": nn.Linear(64, self.cfg.projection_dim),
                "audio": nn.Linear(64, self.cfg.projection_dim),
                "text": nn.Linear(64, self.cfg.projection_dim),
                "behavior": nn.Linear(32, self.cfg.projection_dim),
            }
        )
        self.fusion = nn.Sequential(
            nn.Linear((self.cfg.projection_dim * 4) + 2, self.cfg.hidden_dim),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(self.cfg.hidden_dim, self.cfg.projection_dim),
        )
        self.reconstruct_behavior = nn.Linear(self.cfg.projection_dim, 4)
        self.reconstruct_errors = nn.Linear(self.cfg.projection_dim, 2)
        self.masked_text_head = nn.Linear(64, vocab_size)
        self.pad_id = 0

    def encode_modalities(
        self,
        image: torch.Tensor,
        audio: torch.Tensor,
        text: torch.Tensor,
        behavior: torch.Tensor,
    ) -> dict[str, torch.Tensor]:
        return {
            "handwriting": self.handwriting(image),
            "audio": self.audio(audio),
            "text": self.text(text),
            "behavior": self.behavior(behavior),
        }

    def multimodal_embedding(
        self,
        features: dict[str, torch.Tensor],
        errors: torch.Tensor,
    ) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
        projected = {
            key: F.normalize(self.modality_projectors[key](value), dim=1)
            for key, value in features.items()
        }
        fused = self.fusion(torch.cat([projected["handwriting"], projected["audio"], projected["text"], projected["behavior"], errors], dim=1))
        return F.normalize(fused, dim=1), projected

    def text_reconstruction_loss(self, masked_text: torch.Tensor, original_text: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        pooled = self.text(masked_text)
        logits = self.masked_text_head(pooled)
        target = original_text[:, 0].clone()
        if mask.any():
            first_mask_idx = mask.float().argmax(dim=1)
            target = original_text.gather(1, first_mask_idx.unsqueeze(1)).squeeze(1)
        return F.cross_entropy(logits, target)

    def contrastive_loss(self, anchor: torch.Tensor, other: torch.Tensor) -> torch.Tensor:
        logits = (anchor @ other.T) / self.cfg.temperature
        labels = torch.arange(anchor.size(0), device=anchor.device)
        return F.cross_entropy(logits, labels)

    def pretraining_losses(
        self,
        image: torch.Tensor,
        audio: torch.Tensor,
        text: torch.Tensor,
        errors: torch.Tensor,
        behavior: torch.Tensor,
    ) -> dict[str, torch.Tensor]:
        masked_text, text_mask = random_text_mask(text, pad_id=self.pad_id, mask_probability=self.cfg.text_mask_probability)
        features = self.encode_modalities(image, audio, masked_text, behavior)
        fused, projected = self.multimodal_embedding(features, errors)

        contrastive = (
            self.contrastive_loss(projected["handwriting"], projected["text"])
            + self.contrastive_loss(projected["audio"], projected["text"])
            + self.contrastive_loss(projected["behavior"], projected["text"])
        ) / 3.0
        recon_behavior = F.mse_loss(self.reconstruct_behavior(fused), behavior)
        recon_errors = F.mse_loss(self.reconstruct_errors(fused), errors)
        text_loss = self.text_reconstruction_loss(masked_text, text, text_mask)

        total = (
            (contrastive * self.cfg.contrastive_weight)
            + (text_loss * self.cfg.text_weight)
            + ((recon_behavior + recon_errors) * self.cfg.reconstruction_weight)
        )
        return {
            "total": total,
            "contrastive": contrastive,
            "text": text_loss,
            "reconstruction": recon_behavior + recon_errors,
        }


class LearningDisorderAdapter(nn.Module):
    """Task adapter for dyslexia, dysgraphia, or dyscalculia heads on top of foundation embeddings."""

    def __init__(self, foundation: BengaliLearningDisorderFoundationModel, disorder: str, num_classes: int = 3):
        super().__init__()
        disorder_key = disorder.strip().lower()
        if disorder_key not in {"dyslexia", "dysgraphia", "dyscalculia"}:
            raise ValueError("disorder must be one of: dyslexia, dysgraphia, dyscalculia")
        self.disorder = disorder_key
        self.foundation = foundation
        self.head = nn.Sequential(
            nn.Linear(foundation.cfg.projection_dim, 96),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(96, num_classes),
        )

    def forward(
        self,
        image: torch.Tensor,
        audio: torch.Tensor,
        text: torch.Tensor,
        errors: torch.Tensor,
        behavior: torch.Tensor,
    ) -> torch.Tensor:
        features = self.foundation.encode_modalities(image, audio, text, behavior)
        fused, _ = self.foundation.multimodal_embedding(features, errors)
        return self.head(fused)
