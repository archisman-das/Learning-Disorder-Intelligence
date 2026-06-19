from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.ssl_pretraining import pretrain_audio_ssl


def main() -> None:
    parser = argparse.ArgumentParser(description="Self-supervised Bengali audio representation learning.")
    parser.add_argument("--manifest", required=True, help="Manifest CSV containing audio_path entries.")
    parser.add_argument("--objective", default="contrastive", choices=["contrastive", "masked", "wav2vec2", "hubert"])
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--output", default="checkpoints/ssl/audio_encoder_ssl.pt")
    parser.add_argument(
        "--teacher-model",
        default="facebook/wav2vec2-base-960h",
        help="Hugging Face model name used for wav2vec2/hubert distillation objectives.",
    )
    parser.add_argument("--text-language", default="bengali", choices=["bengali", "english", "multilingual"])
    args = parser.parse_args()

    result = pretrain_audio_ssl(
        manifest_path=args.manifest,
        output_path=args.output,
        objective=args.objective,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        data_config=DataConfig(text_language=args.text_language),
        teacher_model_name=args.teacher_model,
    )
    print(f"Saved SSL checkpoint: {result.checkpoint_path}")
    print(f"Objective: {result.objective}")
    print(f"Final loss: {result.final_loss:.6f}")


if __name__ == "__main__":
    main()
