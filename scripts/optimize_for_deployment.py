from __future__ import annotations

import argparse
import csv
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


def load_checkpoint_model(checkpoint: Path) -> torch.nn.Module:
    payload = torch.load(checkpoint, map_location="cpu")
    num_classes = int(payload.get("num_classes", 2))
    data_config = payload.get("data_config", DataConfig())
    if isinstance(data_config, dict):
        data_config = DataConfig(**data_config)
    model = build_model(payload.get("model_name", "multimodal"), data_config, num_classes=num_classes)
    model.load_state_dict(payload["model_state"])
    model.eval()
    return model


def export_variant(name: str, model: torch.nn.Module, output_dir: Path, config: DataConfig) -> dict[str, object]:
    output_path = output_dir / f"{name}.pt"
    export_torchscript(model, output_path, config)
    metrics = benchmark_torchscript(output_path)
    return {
        "variant": name,
        "path": str(output_path),
        **metrics,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Create pruned, quantized, and lightweight deployment artifacts.")
    parser.add_argument("--checkpoint", default="checkpoints/best_model.pt")
    parser.add_argument("--output-dir", default="exports/deployment")
    parser.add_argument("--prune-amount", type=float, default=0.3)
    args = parser.parse_args()

    checkpoint = Path(args.checkpoint)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    payload = torch.load(checkpoint, map_location="cpu")
    data_config = payload.get("data_config", DataConfig())
    if isinstance(data_config, dict):
        data_config = DataConfig(**data_config)

    rows.append(export_variant("standard", load_checkpoint_model(checkpoint), output_dir, data_config))

    pruned_model = load_checkpoint_model(checkpoint)
    apply_global_pruning(pruned_model, amount=args.prune_amount)
    rows.append(export_variant(f"pruned_{int(args.prune_amount * 100)}", pruned_model, output_dir, data_config))

    quantized_model = apply_dynamic_quantization(load_checkpoint_model(checkpoint))
    rows.append(export_variant("quantized", quantized_model, output_dir, data_config))

    pruned_quantized_model = load_checkpoint_model(checkpoint)
    apply_global_pruning(pruned_quantized_model, amount=args.prune_amount)
    pruned_quantized_model = apply_dynamic_quantization(pruned_quantized_model)
    rows.append(export_variant(f"pruned_{int(args.prune_amount * 100)}_quantized", pruned_quantized_model, output_dir, data_config))

    report_path = output_dir / "deployment_report.csv"
    with report_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["variant", "path", "size_kb", "avg_latency_ms"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Deployment report written to {report_path}")
    for row in rows:
        print(
            f"{row['variant']}: size={row['size_kb']:.1f} KB "
            f"latency={row['avg_latency_ms']:.2f} ms"
        )


if __name__ == "__main__":
    main()
