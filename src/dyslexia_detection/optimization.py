from __future__ import annotations

import time
from pathlib import Path

import torch
from torch import nn
from torch.nn.utils import prune

from .config import DataConfig


def example_inputs(config: DataConfig | None = None) -> tuple[torch.Tensor, ...]:
    config = config or DataConfig()
    return (
        torch.zeros(1, 1, config.image_size, config.image_size),
        torch.zeros(1, config.n_mfcc, config.max_audio_frames),
        torch.ones(1, config.max_text_length, dtype=torch.long),
        torch.zeros(1, 2),
        torch.zeros(1, 4),
    )


def apply_global_pruning(model: nn.Module, amount: float = 0.3) -> nn.Module:
    parameters_to_prune = []
    for module in model.modules():
        if isinstance(module, (nn.Conv1d, nn.Conv2d, nn.Linear)):
            parameters_to_prune.append((module, "weight"))

    if not parameters_to_prune or amount <= 0:
        return model

    prune.global_unstructured(
        parameters_to_prune,
        pruning_method=prune.L1Unstructured,
        amount=amount,
    )
    for module, name in parameters_to_prune:
        prune.remove(module, name)
    return model


def apply_dynamic_quantization(model: nn.Module) -> nn.Module:
    return torch.quantization.quantize_dynamic(
        model,
        {nn.Linear, nn.GRU, nn.LSTM},
        dtype=torch.qint8,
    )


def export_torchscript(model: nn.Module, output_path: str | Path, config: DataConfig | None = None) -> Path:
    model.eval()
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    traced = torch.jit.trace(model, example_inputs(config), check_trace=False)
    traced.save(str(output))
    return output


def benchmark_torchscript(path: str | Path, iterations: int = 30, warmup: int = 5) -> dict[str, float]:
    model = torch.jit.load(str(path), map_location="cpu")
    model.eval()
    inputs = example_inputs()

    with torch.no_grad():
        for _ in range(warmup):
            model(*inputs)
        start = time.perf_counter()
        for _ in range(iterations):
            model(*inputs)
        elapsed = time.perf_counter() - start

    return {
        "size_kb": Path(path).stat().st_size / 1024,
        "avg_latency_ms": (elapsed / iterations) * 1000,
    }
