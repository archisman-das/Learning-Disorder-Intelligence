from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.calibration import calibrated_probabilities
from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.models import build_model
from src.dyslexia_detection.preprocessing import build_char_vocab, encode_text, extract_audio_features, load_handwriting_image


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict dyslexia output with modality attention weights.")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--handwriting", default="")
    parser.add_argument("--audio", default="")
    parser.add_argument("--text", default="")
    parser.add_argument("--sample-language", default="Bengali")
    parser.add_argument("--spelling-errors", type=int, default=0)
    parser.add_argument("--pronunciation-errors", type=int, default=0)
    parser.add_argument("--reading-time-seconds", type=float, default=0.0)
    parser.add_argument("--hesitation-count", type=int, default=0)
    parser.add_argument("--repetition-count", type=int, default=0)
    parser.add_argument("--omission-count", type=int, default=0)
    args = parser.parse_args()

    payload = torch.load(args.checkpoint, map_location="cpu")
    data_config = payload.get("data_config", DataConfig())
    if isinstance(data_config, dict):
        data_config = DataConfig(**data_config)
    num_classes = int(payload.get("num_classes", 2))
    model = build_model(payload.get("model_name", "multimodal"), data_config, num_classes=num_classes)
    model.load_state_dict(payload["model_state"])
    temperature = float(payload.get("temperature", 1.0))
    decision_threshold = float(payload.get("decision_threshold", 0.5))
    model.eval()

    vocab = build_char_vocab(getattr(data_config, "text_language", "bengali"))
    image = torch.tensor(load_handwriting_image(args.handwriting or None, data_config), dtype=torch.float32).unsqueeze(0)
    audio = torch.tensor(extract_audio_features(args.audio or None, data_config), dtype=torch.float32).unsqueeze(0)
    text = torch.tensor(encode_text(args.text, vocab, data_config.max_text_length, args.sample_language), dtype=torch.long).unsqueeze(0)
    errors = torch.tensor([[args.spelling_errors, args.pronunciation_errors]], dtype=torch.float32)
    behavior = torch.tensor(
        [[args.reading_time_seconds, args.hesitation_count, args.repetition_count, args.omission_count]],
        dtype=torch.float32,
    )

    with torch.no_grad():
        logits = model(image, audio, text, errors, behavior)
        probabilities = calibrated_probabilities(logits, temperature).squeeze(0)
    predicted = int(float(probabilities[1].item()) >= decision_threshold) if probabilities.shape[0] == 2 else int(probabilities.argmax().item())
    print(f"predicted_label={predicted}")
    print("probabilities=" + ",".join(f"{float(value):.4f}" for value in probabilities))

    attention = getattr(model, "last_modality_attention", None)
    if attention is None:
        print("modality_attention=not_available_for_this_model")
        return

    print(f"handwriting_importance={float(attention['handwriting'][0]):.4f}")
    print(f"speech_importance={float(attention['speech'][0]):.4f}")
    print(f"text_importance={float(attention['text'][0]):.4f}")
    print(f"reading_behavior_importance={float(attention['reading_behavior'][0]):.4f}")


if __name__ == "__main__":
    main()
