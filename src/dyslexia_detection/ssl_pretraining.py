from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import math
import wave
from functools import lru_cache

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from torch import nn
from torch.utils.data import Dataset

from .config import DataConfig
from .models import AudioEncoder
from .preprocessing import extract_audio_features


class BengaliAudioDataset(Dataset):
    def __init__(self, manifest_path: str | Path, config: DataConfig | None = None):
        self.manifest_path = Path(manifest_path)
        self.root = self.manifest_path.parent
        self.config = config or DataConfig()
        self.frame = pd.read_csv(self.manifest_path)
        if "audio_path" not in self.frame.columns:
            raise ValueError("Manifest must contain audio_path for SSL pretraining.")
        self.paths = [self._resolve_path(value) for value in self.frame["audio_path"]]

    def _resolve_path(self, value: object) -> Path | None:
        if pd.isna(value) or not str(value).strip():
            return None
        path = Path(str(value))
        if path.is_absolute():
            return path
        return (self.root / path).resolve()

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int]:
        audio = extract_audio_features(self.paths[index], self.config)
        return torch.tensor(audio, dtype=torch.float32), int(index)


def _time_mask(spec: torch.Tensor, ratio: float = 0.12) -> torch.Tensor:
    output = spec.clone()
    frames = output.shape[-1]
    width = max(1, int(frames * ratio))
    if width >= frames:
        return output * 0.0
    start = torch.randint(0, frames - width + 1, (1,), device=output.device).item()
    output[..., start : start + width] = 0.0
    return output


def _freq_mask(spec: torch.Tensor, ratio: float = 0.15) -> torch.Tensor:
    output = spec.clone()
    freqs = output.shape[-2]
    width = max(1, int(freqs * ratio))
    if width >= freqs:
        return output * 0.0
    start = torch.randint(0, freqs - width + 1, (1,), device=output.device).item()
    output[..., start : start + width, :] = 0.0
    return output


def augment_spectrogram(spec: torch.Tensor) -> torch.Tensor:
    noisy = spec + (torch.randn_like(spec) * 0.02)
    masked_time = _time_mask(noisy)
    masked = _freq_mask(masked_time)
    return masked


def nt_xent_loss(z1: torch.Tensor, z2: torch.Tensor, temperature: float = 0.2) -> torch.Tensor:
    z1 = F.normalize(z1, dim=1)
    z2 = F.normalize(z2, dim=1)
    representations = torch.cat([z1, z2], dim=0)
    similarity = torch.matmul(representations, representations.T) / temperature
    batch_size = z1.shape[0]
    labels = torch.arange(batch_size, device=z1.device)
    labels = torch.cat([labels + batch_size, labels], dim=0)
    mask = torch.eye(batch_size * 2, device=z1.device, dtype=torch.bool)
    similarity = similarity.masked_fill(mask, -1e9)
    return F.cross_entropy(similarity, labels)


class AudioMaskedReconstructionModel(nn.Module):
    def __init__(self, config: DataConfig):
        super().__init__()
        self.encoder = AudioEncoder(config)
        self.decoder = nn.Sequential(
            nn.Linear(64, 128),
            nn.GELU(),
            nn.Linear(128, config.n_mfcc * config.max_audio_frames),
        )
        self.config = config

    def forward(self, audio: torch.Tensor) -> torch.Tensor:
        latent = self.encoder(audio)
        reconstruction = self.decoder(latent)
        return reconstruction.view(audio.shape[0], self.config.n_mfcc, self.config.max_audio_frames)


class AudioContrastiveModel(nn.Module):
    def __init__(self, config: DataConfig):
        super().__init__()
        self.encoder = AudioEncoder(config)
        self.projector = nn.Sequential(
            nn.Linear(64, 128),
            nn.GELU(),
            nn.Linear(128, 64),
        )

    def forward(self, audio: torch.Tensor) -> torch.Tensor:
        return self.projector(self.encoder(audio))


class AudioTeacherDistillModel(nn.Module):
    def __init__(self, config: DataConfig):
        super().__init__()
        self.encoder = AudioEncoder(config)
        self.projector = nn.Sequential(
            nn.Linear(64, 128),
            nn.GELU(),
            nn.Linear(128, 256),
        )

    def forward(self, audio: torch.Tensor) -> torch.Tensor:
        return self.projector(self.encoder(audio))


def _read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        sample_rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    if sample_width == 1:
        data = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        data = (data - 128.0) / 128.0
    elif sample_width == 2:
        data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        data = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported WAV sample width: {sample_width}")
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, sample_rate


def _resample_linear(waveform_data: np.ndarray, old_rate: int, new_rate: int) -> np.ndarray:
    if old_rate == new_rate or waveform_data.size == 0:
        return waveform_data
    duration = waveform_data.size / old_rate
    old_times = np.linspace(0, duration, num=waveform_data.size, endpoint=False)
    new_size = max(1, int(duration * new_rate))
    new_times = np.linspace(0, duration, num=new_size, endpoint=False)
    return np.interp(new_times, old_times, waveform_data).astype(np.float32)


@lru_cache(maxsize=4)
def _load_teacher(model_name: str):
    from transformers import AutoModel, AutoProcessor  # type: ignore

    processor = AutoProcessor.from_pretrained(model_name)
    teacher = AutoModel.from_pretrained(model_name)
    teacher.eval()
    return processor, teacher


def _teacher_embedding(path: Path | None, model_name: str, target_sample_rate: int = 16_000) -> torch.Tensor:
    if path is None or not path.exists():
        return torch.zeros(256, dtype=torch.float32)
    try:
        _load_teacher(model_name)
    except ImportError as error:
        raise RuntimeError(
            "transformers is required for wav2vec2/hubert distillation. Install with: python -m pip install transformers"
        ) from error

    waveform, sample_rate = _read_wav_mono(path)
    if sample_rate != target_sample_rate:
        waveform = _resample_linear(waveform, sample_rate, target_sample_rate)
    processor, teacher = _load_teacher(model_name)
    with torch.no_grad():
        inputs = processor(waveform, sampling_rate=target_sample_rate, return_tensors="pt")
        hidden = teacher(**inputs).last_hidden_state.mean(dim=1).squeeze(0)
    if hidden.numel() >= 256:
        return hidden[:256].float().cpu()
    return F.pad(hidden.float().cpu(), (0, 256 - hidden.numel()))


@dataclass(frozen=True)
class SSLResult:
    checkpoint_path: Path
    objective: str
    final_loss: float


def pretrain_audio_ssl(
    manifest_path: str | Path,
    output_path: str | Path,
    objective: str = "contrastive",
    epochs: int = 5,
    batch_size: int = 16,
    learning_rate: float = 1e-3,
    data_config: DataConfig | None = None,
    teacher_model_name: str = "",
) -> SSLResult:
    config = data_config or DataConfig()
    dataset = BengaliAudioDataset(manifest_path, config=config)
    loader = torch.utils.data.DataLoader(dataset, batch_size=batch_size, shuffle=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if objective == "contrastive":
        model = AudioContrastiveModel(config).to(device)
    elif objective == "masked":
        model = AudioMaskedReconstructionModel(config).to(device)
    elif objective in {"wav2vec2", "hubert"}:
        model = AudioTeacherDistillModel(config).to(device)
    else:
        raise ValueError(f"Unsupported objective: {objective}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    final_loss = math.inf

    for epoch in range(1, epochs + 1):
        model.train()
        running = 0.0
        steps = 0
        for _, batch in enumerate(loader):
            audio, sample_indices = batch
            audio = audio.to(device)
            optimizer.zero_grad(set_to_none=True)

            if objective == "contrastive":
                view_1 = augment_spectrogram(audio)
                view_2 = augment_spectrogram(audio)
                z1 = model(view_1)
                z2 = model(view_2)
                loss = nt_xent_loss(z1, z2)
            elif objective == "masked":
                masked = _time_mask(audio)
                reconstruction = model(masked)
                loss = F.mse_loss(reconstruction, audio)
            else:
                features = model(audio)
                targets = []
                for sample_index in sample_indices.tolist():
                    path = dataset.paths[int(sample_index)] if int(sample_index) < len(dataset.paths) else None
                    targets.append(_teacher_embedding(path, teacher_model_name))
                target_tensor = torch.stack(targets, dim=0).to(device)
                loss = F.mse_loss(features, target_tensor)

            loss.backward()
            optimizer.step()
            running += float(loss.item())
            steps += 1

        final_loss = running / max(1, steps)
        print(f"ssl_epoch={epoch} objective={objective} loss={final_loss:.5f}")

    checkpoint = Path(output_path)
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "objective": objective,
            "data_config": config.__dict__,
            "audio_encoder_state": model.encoder.state_dict(),
            "final_loss": float(final_loss),
            "teacher_model_name": teacher_model_name,
        },
        checkpoint,
    )
    return SSLResult(checkpoint_path=checkpoint, objective=objective, final_loss=float(final_loss))
