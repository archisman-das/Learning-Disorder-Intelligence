from __future__ import annotations

import argparse
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.preprocessing import build_char_vocab, encode_text, extract_audio_features, load_handwriting_image


def predict_frame(
    model,
    frame_bgr: np.ndarray,
    text_sample: str,
    spelling_errors: int,
    pronunciation_errors: int,
    reading_time_seconds: float,
    hesitation_count: int,
    repetition_count: int,
    omission_count: int,
    sample_language: str = "Bengali",
    model_text_language: str = "bengali",
) -> tuple[int, float, float]:
    config = DataConfig()
    vocab = build_char_vocab(model_text_language)
    frame_rgb = frame_bgr[:, :, ::-1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as handle:
        Image.fromarray(frame_rgb).save(handle.name)
        image_path = Path(handle.name)

    image = torch.tensor(load_handwriting_image(image_path, config), dtype=torch.float32).unsqueeze(0)
    audio = torch.tensor(extract_audio_features(None, config), dtype=torch.float32).unsqueeze(0)
    text = torch.tensor(encode_text(text_sample, vocab, config.max_text_length, sample_language), dtype=torch.long).unsqueeze(0)
    errors = torch.tensor([[spelling_errors, pronunciation_errors]], dtype=torch.float32)
    behavior = torch.tensor(
        [[reading_time_seconds, hesitation_count, repetition_count, omission_count]],
        dtype=torch.float32,
    )
    image_path.unlink(missing_ok=True)

    with torch.no_grad():
        probabilities = torch.softmax(model(image, audio, text, errors, behavior), dim=1).squeeze(0)
    return int(probabilities.argmax().item()), float(probabilities.max().item()), float(probabilities[1].item())


def main() -> None:
    parser = argparse.ArgumentParser(description="Run real-time webcam handwriting screening.")
    parser.add_argument("--model", default="exports/deployment/pruned_30_quantized.pt")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between model predictions.")
    parser.add_argument("--text", default="ami bangla pori")
    parser.add_argument("--sample-language", default="Bengali")
    parser.add_argument("--model-text-language", default="bengali", choices=["bengali", "hindi", "english", "multilingual"])
    parser.add_argument("--spelling-errors", type=int, default=0)
    parser.add_argument("--pronunciation-errors", type=int, default=0)
    parser.add_argument("--reading-time-seconds", type=float, default=0.0)
    parser.add_argument("--hesitation-count", type=int, default=0)
    parser.add_argument("--repetition-count", type=int, default=0)
    parser.add_argument("--omission-count", type=int, default=0)
    args = parser.parse_args()

    try:
        import cv2
    except ImportError as error:
        raise SystemExit("OpenCV is required for real-time webcam analysis. Install opencv-python.") from error

    model = torch.jit.load(args.model, map_location="cpu")
    model.eval()
    capture = cv2.VideoCapture(args.camera)
    if not capture.isOpened():
        raise SystemExit(f"Could not open camera index {args.camera}")

    last_prediction_time = 0.0
    label = 0
    confidence = 0.0
    elevated_probability = 0.0

    while True:
        ok, frame = capture.read()
        if not ok:
            break

        now = time.time()
        if now - last_prediction_time >= args.interval:
            label, confidence, elevated_probability = predict_frame(
                model,
                frame,
                args.text,
                args.spelling_errors,
                args.pronunciation_errors,
                args.reading_time_seconds,
                args.hesitation_count,
                args.repetition_count,
                args.omission_count,
                args.sample_language,
                args.model_text_language,
            )
            last_prediction_time = now

        color = (0, 0, 255) if label == 1 else (0, 180, 0)
        label_text = "Elevated risk" if label == 1 else "Low risk"
        cv2.putText(frame, f"{label_text} conf={confidence:.2f}", (20, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2)
        cv2.putText(frame, f"elevated probability={elevated_probability:.2f}", (20, 68), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        cv2.imshow("Dyslexia Webcam Analysis", frame)
        if cv2.waitKey(1) & 0xFF in {ord("q"), 27}:
            break

    capture.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
