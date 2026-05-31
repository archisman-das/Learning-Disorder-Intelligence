from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.architecture import ScreeningPipeline
from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.models import MultimodalDyslexiaModel


def safe_text(value: object) -> str:
    return str(value).encode("unicode_escape").decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one sample through the proposed system architecture.")
    parser.add_argument("--manifest", default="data/demo/manifest.csv")
    parser.add_argument("--sample-id", default="S001")
    parser.add_argument("--checkpoint", default="checkpoints/best_model.pt")
    args = parser.parse_args()

    model = MultimodalDyslexiaModel(DataConfig())
    payload = torch.load(args.checkpoint, map_location="cpu")
    model.load_state_dict(payload["model_state"])
    report = ScreeningPipeline(model).run(args.manifest, args.sample_id)

    for layer_name, layer_output in report.items():
        print(f"\n[{layer_name}]")
        if layer_name == "input_layer":
            for key, value in layer_output.__dict__.items():
                print(f"{key}={safe_text(value)}")
        elif layer_name == "classification_layer":
            probabilities = layer_output["probabilities"]
            print(f"fused_feature_shape={layer_output['fused_feature_shape']}")
            print(f"predicted_label={layer_output['predicted_label']}")
            print(f"confidence={layer_output['confidence']:.4f}")
            print(f"probabilities={probabilities.tolist()}")
        else:
            for key, value in layer_output.items():
                print(f"{key}={value}")


if __name__ == "__main__":
    main()
