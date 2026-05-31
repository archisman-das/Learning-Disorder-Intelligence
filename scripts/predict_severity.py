from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.models import build_model
from src.dyslexia_detection.preprocessing import build_char_vocab, encode_text, extract_audio_features, load_handwriting_image
from src.dyslexia_detection.severity import SEVERITY_LABELS, severity_from_score


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict dyslexia severity from a trained checkpoint.")
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
    task = payload.get("task", "binary")
    num_classes = int(payload.get("num_classes", 2 if task == "binary" else 3 if task == "severity" else 1))
    model = build_model(payload.get("model_name", "multimodal"), data_config, num_classes=num_classes)
    model.load_state_dict(payload["model_state"])
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

    if task == "regression":
        score = float(torch.clamp(logits.squeeze(1), 0.0, 1.0).item())
        label_id = severity_from_score(score)
        print(f"task=regression")
        print(f"severity_score={score:.4f}")
        print(f"severity_label={SEVERITY_LABELS[label_id]}")
        return

    probabilities = torch.softmax(logits, dim=1).squeeze(0)
    if task == "severity":
        label_id = int(probabilities.argmax().item())
        print("task=severity")
        print(f"severity_label={SEVERITY_LABELS[label_id]}")
        print(f"mild_probability={float(probabilities[0]):.4f}")
        print(f"moderate_probability={float(probabilities[1]):.4f}")
        print(f"severe_probability={float(probabilities[2]):.4f}")
    else:
        label_id = int(probabilities.argmax().item())
        print("task=binary")
        print(f"predicted_label={label_id}")
        print(f"low_risk_probability={float(probabilities[0]):.4f}")
        print(f"elevated_risk_probability={float(probabilities[1]):.4f}")


if __name__ == "__main__":
    main()
