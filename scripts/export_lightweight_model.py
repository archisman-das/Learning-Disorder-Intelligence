from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.models import build_model
from src.dyslexia_detection.optimization import (
    apply_dynamic_quantization,
    apply_global_pruning,
    benchmark_torchscript,
    export_torchscript,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the dyslexia model for lightweight offline inference.")
    parser.add_argument("--checkpoint", default="checkpoints/best_model.pt")
    parser.add_argument("--output-dir", default="exports")
    parser.add_argument("--quantize", action="store_true", help="Apply dynamic CPU quantization to Linear and GRU layers.")
    parser.add_argument("--prune-amount", type=float, default=0.0, help="Global unstructured pruning amount from 0.0 to 0.9.")
    parser.add_argument("--benchmark", action="store_true", help="Benchmark exported TorchScript latency.")
    args = parser.parse_args()

    checkpoint_path = Path(args.checkpoint)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    payload = torch.load(checkpoint_path, map_location="cpu")
    model_name = payload.get("model_name", "multimodal")
    num_classes = int(payload.get("num_classes", 2))
    data_config = payload.get("data_config", DataConfig())
    if isinstance(data_config, dict):
        data_config = DataConfig(**data_config)
    model = build_model(model_name, data_config, num_classes=num_classes)
    model.load_state_dict(payload["model_state"])
    model.eval()

    export_model = model
    suffix_parts = []
    if args.prune_amount > 0:
        export_model = apply_global_pruning(export_model, amount=args.prune_amount)
        suffix_parts.append(f"pruned_{int(args.prune_amount * 100)}")
    if args.quantize:
        export_model = apply_dynamic_quantization(export_model)
        suffix_parts.append("quantized")
    suffix = "_".join(suffix_parts) if suffix_parts else "standard"
    output_path = output_dir / f"dyslexia_model_{suffix}.pt"
    export_torchscript(export_model, output_path, data_config)
    print(f"Exported {suffix} model to {output_path}")

    if args.benchmark:
        metrics = benchmark_torchscript(output_path)
        report_path = output_dir / f"dyslexia_model_{suffix}_report.json"
        report_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        print(f"Benchmark report written to {report_path}")
        print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
