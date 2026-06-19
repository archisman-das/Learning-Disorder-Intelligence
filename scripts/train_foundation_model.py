from __future__ import annotations

import argparse
from pathlib import Path
import sys

import torch
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.dataset import DyslexiaManifestDataset
from src.dyslexia_detection.foundation import BengaliLearningDisorderFoundationModel, FoundationConfig


def train_epoch(
    model: BengaliLearningDisorderFoundationModel,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
) -> dict[str, float]:
    model.train()
    running = {"total": 0.0, "contrastive": 0.0, "text": 0.0, "reconstruction": 0.0}
    steps = 0
    for batch in loader:
        image = batch["image"].to(device)
        audio = batch["audio"].to(device)
        text = batch["text"].to(device)
        errors = batch["errors"].to(device)
        behavior = batch["behavior"].to(device)

        losses = model.pretraining_losses(image, audio, text, errors, behavior)
        optimizer.zero_grad(set_to_none=True)
        losses["total"].backward()
        optimizer.step()

        for key in running:
            running[key] += float(losses[key].detach().cpu().item())
        steps += 1
    if steps == 0:
        return running
    return {key: value / steps for key, value in running.items()}


def main() -> None:
    parser = argparse.ArgumentParser(description="Pretrain Bengali multimodal learning-disorder foundation model.")
    parser.add_argument("--manifest", default="data/demo/audio_augmented_manifest.csv")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--text-language", default="bengali", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--checkpoint", default="checkpoints/foundation/bengali_foundation.pt")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    data_config = DataConfig(text_language=args.text_language)
    dataset = DyslexiaManifestDataset(args.manifest, config=data_config)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True)
    model = BengaliLearningDisorderFoundationModel(data_config=data_config, cfg=FoundationConfig()).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=args.weight_decay)

    for epoch in range(1, args.epochs + 1):
        metrics = train_epoch(model, loader, optimizer, device)
        print(
            f"Epoch {epoch}/{args.epochs} | total={metrics['total']:.4f} "
            f"| contrastive={metrics['contrastive']:.4f} | text={metrics['text']:.4f} "
            f"| reconstruction={metrics['reconstruction']:.4f}",
            flush=True,
        )

    checkpoint = Path(args.checkpoint)
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state": model.state_dict(),
            "data_config": data_config.__dict__,
            "foundation_config": model.cfg.__dict__,
            "model_name": "bengali_learning_disorder_foundation",
        },
        checkpoint,
    )
    print(f"Saved foundation checkpoint to {checkpoint}", flush=True)


if __name__ == "__main__":
    main()
