from __future__ import annotations

from dataclasses import dataclass

import torch
import torch.nn.functional as F


@dataclass(frozen=True)
class CalibrationResult:
    temperature: float
    nll: float


def _temperature_grid() -> list[float]:
    values = [0.5, 0.75, 1.0]
    values.extend([round(x, 2) for x in torch.arange(1.25, 5.25, 0.25).tolist()])
    return values


def fit_temperature(logits: torch.Tensor, labels: torch.Tensor) -> CalibrationResult:
    if logits.numel() == 0 or labels.numel() == 0:
        return CalibrationResult(temperature=1.0, nll=0.0)

    logits = logits.detach().float()
    labels = labels.detach().long()
    if logits.ndim != 2:
        raise ValueError("Calibration logits must have shape [N, C].")
    if labels.ndim != 1:
        labels = labels.view(-1)

    best_temperature = 1.0
    best_nll = float("inf")
    for temperature in _temperature_grid():
        scaled = logits / max(float(temperature), 1e-6)
        nll = float(F.cross_entropy(scaled, labels).item())
        if nll < best_nll:
            best_nll = nll
            best_temperature = float(temperature)
    return CalibrationResult(temperature=best_temperature, nll=best_nll)


def apply_temperature_scaling(logits: torch.Tensor, temperature: float) -> torch.Tensor:
    return logits / max(float(temperature), 1e-6)


def calibrated_probabilities(logits: torch.Tensor, temperature: float) -> torch.Tensor:
    return torch.softmax(apply_temperature_scaling(logits, temperature), dim=-1)
