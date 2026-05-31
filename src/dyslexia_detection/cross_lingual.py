from __future__ import annotations

from dataclasses import dataclass

import torch
import torch.nn.functional as F
from torch import nn


@dataclass(frozen=True)
class TransferReport:
    copied_tensors: int
    skipped_tensors: int
    copied_parameters: int


def transfer_matching_weights(
    target_model: nn.Module,
    source_state: dict[str, torch.Tensor],
    include_prefixes: tuple[str, ...] = ("handwriting.", "audio.", "behavior.", "classifier."),
) -> TransferReport:
    target_state = target_model.state_dict()
    copied_tensors = 0
    skipped_tensors = 0
    copied_parameters = 0

    for name, target_value in target_state.items():
        if include_prefixes and not any(name.startswith(prefix) for prefix in include_prefixes):
            skipped_tensors += 1
            continue
        source_value = source_state.get(name)
        if source_value is None or source_value.shape != target_value.shape:
            skipped_tensors += 1
            continue
        target_state[name] = source_value.clone()
        copied_tensors += 1
        copied_parameters += int(source_value.numel())

    target_model.load_state_dict(target_state, strict=False)
    return TransferReport(
        copied_tensors=copied_tensors,
        skipped_tensors=skipped_tensors,
        copied_parameters=copied_parameters,
    )


def set_trainable_by_prefix(model: nn.Module, trainable_prefixes: tuple[str, ...]) -> None:
    for name, parameter in model.named_parameters():
        parameter.requires_grad = any(name.startswith(prefix) for prefix in trainable_prefixes)


def shared_feature_distillation_loss(student: nn.Module, teacher: nn.Module, image: torch.Tensor, audio: torch.Tensor, behavior: torch.Tensor) -> torch.Tensor:
    losses: list[torch.Tensor] = []
    with torch.no_grad():
        if hasattr(teacher, "handwriting") and hasattr(student, "handwriting"):
            teacher_h = teacher.handwriting(image)
            student_h = student.handwriting(image)
            losses.append(F.mse_loss(student_h, teacher_h))
        if hasattr(teacher, "audio") and hasattr(student, "audio"):
            teacher_a = teacher.audio(audio)
            student_a = student.audio(audio)
            losses.append(F.mse_loss(student_a, teacher_a))
        if hasattr(teacher, "behavior") and hasattr(student, "behavior"):
            teacher_b = teacher.behavior(behavior)
            student_b = student.behavior(behavior)
            losses.append(F.mse_loss(student_b, teacher_b))

    if not losses:
        return torch.tensor(0.0, dtype=image.dtype, device=image.device)
    return sum(losses) / len(losses)
