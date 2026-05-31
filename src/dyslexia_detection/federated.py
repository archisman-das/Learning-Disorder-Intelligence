from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import torch
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error
from torch import nn
from torch.utils.data import DataLoader

from .config import DataConfig
from .dataset import DyslexiaManifestDataset
from .models import build_model


@dataclass(frozen=True)
class FederatedConfig:
    model_name: str = "multimodal_attention"
    task: str = "severity"
    rounds: int = 5
    local_epochs: int = 1
    batch_size: int = 8
    learning_rate: float = 1e-3
    text_language: str = "multilingual"
    device: str = "cpu"


def _build_criterion(task: str) -> nn.Module:
    return nn.CrossEntropyLoss() if task in {"binary", "severity"} else nn.MSELoss()


def _target_tensor(batch: dict[str, torch.Tensor], task: str) -> torch.Tensor:
    if task == "binary":
        return batch["label"]
    if task == "severity":
        return batch["severity_label"]
    return batch["severity_score"]


def _aggregate_weights(states: list[dict[str, torch.Tensor]], weights: list[int]) -> dict[str, torch.Tensor]:
    total = float(sum(weights))
    merged: dict[str, torch.Tensor] = {}
    for key in states[0]:
        merged[key] = sum((state[key] * (w / total) for state, w in zip(states, weights, strict=False)))
    return merged


def _local_train(
    global_state: dict[str, torch.Tensor],
    manifest_path: str | Path,
    cfg: FederatedConfig,
    num_classes: int,
) -> tuple[dict[str, torch.Tensor], int, float]:
    data_config = DataConfig(text_language=cfg.text_language)
    dataset = DyslexiaManifestDataset(manifest_path, data_config)
    loader = DataLoader(dataset, batch_size=cfg.batch_size, shuffle=True)

    model = build_model(cfg.model_name, data_config, num_classes=num_classes).to(cfg.device)
    model.load_state_dict(global_state)
    model.train()

    optimizer = torch.optim.AdamW(model.parameters(), lr=cfg.learning_rate, weight_decay=1e-4)
    criterion = _build_criterion(cfg.task)
    mean_loss = 0.0

    for _ in range(cfg.local_epochs):
        running = 0.0
        steps = 0
        for batch in loader:
            batch = {key: value.to(cfg.device) for key, value in batch.items()}
            optimizer.zero_grad(set_to_none=True)
            logits = model(batch["image"], batch["audio"], batch["text"], batch["errors"], batch["behavior"])
            target = _target_tensor(batch, cfg.task)
            if cfg.task == "regression":
                loss = criterion(logits.squeeze(1), target)
            else:
                loss = criterion(logits, target)
            loss.backward()
            optimizer.step()
            running += float(loss.item())
            steps += 1
        mean_loss = running / max(1, steps)
    return model.state_dict(), len(dataset), float(mean_loss)


def evaluate_global(model: nn.Module, manifest_path: str | Path, task: str, text_language: str, batch_size: int = 8, device: str = "cpu") -> dict[str, float]:
    dataset = DyslexiaManifestDataset(manifest_path, DataConfig(text_language=text_language))
    loader = DataLoader(dataset, batch_size=batch_size)
    model.eval()
    if task == "regression":
        targets: list[float] = []
        predictions: list[float] = []
        with torch.no_grad():
            for batch in loader:
                batch = {key: value.to(device) for key, value in batch.items()}
                outputs = model(batch["image"], batch["audio"], batch["text"], batch["errors"], batch["behavior"]).squeeze(1)
                predictions.extend(outputs.cpu().tolist())
                targets.extend(batch["severity_score"].cpu().tolist())
        mae = mean_absolute_error(targets, predictions)
        return {"mae": float(mae), "score": float(-mae)}

    labels: list[int] = []
    predictions: list[int] = []
    target_key = "label" if task == "binary" else "severity_label"
    with torch.no_grad():
        for batch in loader:
            batch = {key: value.to(device) for key, value in batch.items()}
            logits = model(batch["image"], batch["audio"], batch["text"], batch["errors"], batch["behavior"])
            predictions.extend(logits.argmax(dim=1).cpu().tolist())
            labels.extend(batch[target_key].cpu().tolist())
    averaging = "binary" if task == "binary" else "macro"
    f1 = f1_score(labels, predictions, average=averaging, zero_division=0)
    return {"accuracy": float(accuracy_score(labels, predictions)), "f1": float(f1), "score": float(f1)}


def run_federated_training(
    client_manifests: list[str | Path],
    output_dir: str | Path,
    config: FederatedConfig,
    validation_manifest: str | Path | None = None,
) -> Path:
    if not client_manifests:
        raise ValueError("At least one client manifest is required.")
    device = config.device if config.device else ("cuda" if torch.cuda.is_available() else "cpu")
    cfg = FederatedConfig(
        model_name=config.model_name,
        task=config.task,
        rounds=config.rounds,
        local_epochs=config.local_epochs,
        batch_size=config.batch_size,
        learning_rate=config.learning_rate,
        text_language=config.text_language,
        device=device,
    )
    num_classes = 2 if cfg.task == "binary" else 3 if cfg.task == "severity" else 1
    global_model = build_model(cfg.model_name, DataConfig(text_language=cfg.text_language), num_classes=num_classes).to(cfg.device)
    global_state = global_model.state_dict()

    history: list[dict[str, float]] = []
    for round_id in range(1, cfg.rounds + 1):
        local_states: list[dict[str, torch.Tensor]] = []
        sample_weights: list[int] = []
        losses: list[float] = []
        for manifest in client_manifests:
            state, sample_count, loss = _local_train(global_state, manifest, cfg, num_classes)
            local_states.append(state)
            sample_weights.append(sample_count)
            losses.append(loss)
        global_state = _aggregate_weights(local_states, sample_weights)
        global_model.load_state_dict(global_state)
        row: dict[str, float] = {
            "round": float(round_id),
            "mean_local_loss": float(sum(losses) / max(1, len(losses))),
            "total_samples": float(sum(sample_weights)),
        }
        if validation_manifest is not None:
            metrics = evaluate_global(
                global_model,
                validation_manifest,
                cfg.task,
                cfg.text_language,
                batch_size=cfg.batch_size,
                device=cfg.device,
            )
            row.update({f"val_{key}": value for key, value in metrics.items()})
        history.append(row)
        print("federated_round=" + str(round_id) + " " + " ".join(f"{k}={v:.4f}" for k, v in row.items() if k != "round"))

    output_root = Path(output_dir)
    output_root.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output_root / "federated_global_model.pt"
    torch.save(
        {
            "model_name": cfg.model_name,
            "task": cfg.task,
            "num_classes": num_classes,
            "model_state": global_model.state_dict(),
            "data_config": DataConfig(text_language=cfg.text_language).__dict__,
            "federated_config": cfg.__dict__,
            "history": history,
        },
        checkpoint_path,
    )
    pd.DataFrame(history).to_csv(output_root / "federated_history.csv", index=False)
    return checkpoint_path
