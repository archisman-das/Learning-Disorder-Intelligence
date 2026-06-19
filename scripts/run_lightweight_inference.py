from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.preprocessing import build_char_vocab, encode_text, extract_audio_features, load_handwriting_image


def main() -> None:
    parser = argparse.ArgumentParser(description="Run offline inference with a TorchScript deployment artifact.")
    parser.add_argument("--model", default="exports/deployment/pruned_30_quantized.pt")
    parser.add_argument("--handwriting", default="")
    parser.add_argument("--audio", default="")
    parser.add_argument("--text", default="")
    parser.add_argument("--sample-language", default="Bengali")
    parser.add_argument("--model-text-language", default="bengali", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--spelling-errors", type=int, default=0)
    parser.add_argument("--pronunciation-errors", type=int, default=0)
    parser.add_argument("--reading-time-seconds", type=float, default=0.0)
    parser.add_argument("--hesitation-count", type=int, default=0)
    parser.add_argument("--repetition-count", type=int, default=0)
    parser.add_argument("--omission-count", type=int, default=0)
    args = parser.parse_args()

    config = DataConfig()
    vocab = build_char_vocab(args.model_text_language)
    model = torch.jit.load(args.model, map_location="cpu")
    model.eval()

    image = torch.tensor(load_handwriting_image(args.handwriting or None, config), dtype=torch.float32).unsqueeze(0)
    audio = torch.tensor(extract_audio_features(args.audio or None, config), dtype=torch.float32).unsqueeze(0)
    text = torch.tensor(encode_text(args.text, vocab, config.max_text_length, args.sample_language), dtype=torch.long).unsqueeze(0)
    errors = torch.tensor([[args.spelling_errors, args.pronunciation_errors]], dtype=torch.float32)
    behavior = torch.tensor(
        [[args.reading_time_seconds, args.hesitation_count, args.repetition_count, args.omission_count]],
        dtype=torch.float32,
    )

    with torch.no_grad():
        probabilities = torch.softmax(model(image, audio, text, errors, behavior), dim=1).squeeze(0)
    print(f"low_risk_probability={float(probabilities[0]):.4f}")
    print(f"elevated_risk_probability={float(probabilities[1]):.4f}")
    print(f"predicted_label={int(probabilities.argmax().item())}")


if __name__ == "__main__":
    main()
