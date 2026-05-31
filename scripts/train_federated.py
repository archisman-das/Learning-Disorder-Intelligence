from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.federated import FederatedConfig, run_federated_training


def _resolve_client_manifests(manifests: str, manifests_dir: str) -> list[Path]:
    if manifests:
        return [Path(item.strip()) for item in manifests.split(",") if item.strip()]
    if manifests_dir:
        root = Path(manifests_dir)
        return sorted(root.glob("*.csv"))
    raise ValueError("Provide --client-manifests or --client-manifests-dir.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run federated learning across multiple client manifests.")
    parser.add_argument("--client-manifests", default="", help="Comma-separated list of client manifest CSV paths.")
    parser.add_argument("--client-manifests-dir", default="", help="Directory containing client manifest CSV files.")
    parser.add_argument("--validation-manifest", default="", help="Optional validation manifest for global evaluation.")
    parser.add_argument("--output-dir", default="checkpoints/federated")
    parser.add_argument("--model", default="multimodal_attention", choices=["multimodal", "vit_transformer", "multimodal_attention", "cnn_lstm"])
    parser.add_argument("--task", default="severity", choices=["binary", "severity", "regression"])
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--local-epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--text-language", default="multilingual", choices=["bengali", "hindi", "english", "multilingual"])
    args = parser.parse_args()

    client_manifests = _resolve_client_manifests(args.client_manifests, args.client_manifests_dir)
    checkpoint = run_federated_training(
        client_manifests=client_manifests,
        output_dir=args.output_dir,
        config=FederatedConfig(
            model_name=args.model,
            task=args.task,
            rounds=args.rounds,
            local_epochs=args.local_epochs,
            batch_size=args.batch_size,
            learning_rate=args.learning_rate,
            text_language=args.text_language,
        ),
        validation_manifest=args.validation_manifest or None,
    )
    print(f"federated_checkpoint={checkpoint}")


if __name__ == "__main__":
    main()
