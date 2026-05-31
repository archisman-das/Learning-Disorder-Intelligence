from __future__ import annotations

import re
import unicodedata
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from .config import DataConfig, get_language_charset


def build_char_vocab(language: str = "bengali", chars: str | None = None) -> dict[str, int]:
    chars = chars if chars is not None else get_language_charset(language)
    vocab: dict[str, int] = {"<pad>": 0, "<unk>": 1}
    for char in chars:
        if char not in vocab:
            vocab[char] = len(vocab)
    return vocab


def normalize_text(text: str, language: str = "bengali") -> str:
    text = unicodedata.normalize("NFC", str(text))
    text = text.strip()
    if str(language).strip().lower() in {"english", "latin"}:
        text = text.lower()
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_bengali_text(text: str) -> str:
    return normalize_text(text, "bengali")


def encode_text(text: str, vocab: dict[str, int], max_length: int, language: str = "bengali") -> np.ndarray:
    text = normalize_text(text, language)
    pad_id = vocab["<pad>"]
    unk_id = vocab["<unk>"]
    encoded = np.full(max_length, pad_id, dtype=np.int64)
    for index, char in enumerate(text[:max_length]):
        encoded[index] = vocab.get(char, unk_id)
    return encoded


def load_handwriting_image(path: str | Path | None, config: DataConfig) -> np.ndarray:
    if not path:
        return np.zeros((1, config.image_size, config.image_size), dtype=np.float32)

    image_path = Path(path)
    if not image_path.exists():
        return np.zeros((1, config.image_size, config.image_size), dtype=np.float32)

    image = Image.open(image_path).convert("L")
    image = ImageOps.autocontrast(image)
    image = ImageOps.pad(image, (config.image_size, config.image_size), color=255)
    array = np.asarray(image, dtype=np.float32) / 255.0
    array = 1.0 - array
    return array[None, :, :]


def extract_audio_features(path: str | Path | None, config: DataConfig) -> np.ndarray:
    if not path:
        return np.zeros((config.n_mfcc, config.max_audio_frames), dtype=np.float32)

    audio_path = Path(path)
    if not audio_path.exists():
        return np.zeros((config.n_mfcc, config.max_audio_frames), dtype=np.float32)

    waveform_data, sample_rate = _read_wav_mono(audio_path)
    if sample_rate != config.sample_rate:
        waveform_data = _resample_linear(waveform_data, sample_rate, config.sample_rate)
    spectrogram = _log_spectrogram(waveform_data, config)

    if spectrogram.shape[1] < config.max_audio_frames:
        pad_width = config.max_audio_frames - spectrogram.shape[1]
        spectrogram = np.pad(spectrogram, ((0, 0), (0, pad_width)))
    else:
        spectrogram = spectrogram[:, : config.max_audio_frames]

    mean = spectrogram.mean()
    std = spectrogram.std() + 1e-6
    return (spectrogram - mean) / std


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


def _log_spectrogram(waveform_data: np.ndarray, config: DataConfig) -> np.ndarray:
    if waveform_data.size == 0:
        return np.zeros((config.n_mfcc, config.max_audio_frames), dtype=np.float32)

    frame_size = 512
    hop_size = 160
    if waveform_data.size < frame_size:
        waveform_data = np.pad(waveform_data, (0, frame_size - waveform_data.size))

    frames = []
    window = np.hanning(frame_size).astype(np.float32)
    for start in range(0, waveform_data.size - frame_size + 1, hop_size):
        frame = waveform_data[start : start + frame_size] * window
        spectrum = np.abs(np.fft.rfft(frame))
        frames.append(np.log1p(spectrum[: config.n_mfcc]))

    if not frames:
        return np.zeros((config.n_mfcc, config.max_audio_frames), dtype=np.float32)
    return np.stack(frames, axis=1).astype(np.float32)
