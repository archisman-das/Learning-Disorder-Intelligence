from __future__ import annotations

import argparse
from pathlib import Path
import sys

import torch
from torch import nn
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.dataset import DyslexiaManifestDataset
from src.dyslexia_detection.foundation import BengaliLearningDisorderFoundationModel, LearningDisorderAdapter


def select_target(batch: dict[str, torch.Tensor], disorder: str) -> torch.Tensor:
    key = disorder.strip().lower()
    if key == "dyslexia":
        return batch["severity_label"]
    if key == "dysgraphia":
        return batch["severity_label"]
    if key == "dyscalculia":
        return batch["severity_label"]
    raise ValueError(f"Unsupported disorder: {disorder}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune disorder-specific adapter on top of foundation model.")
    parser.add_argument("--manifest", default="data/demo/audio_augmented_manifest.csv")
    parser.add_argument("--foundation-checkpoint", default="checkpoints/foundation/bengali_foundation.pt")
    parser.add_argument("--disorder", default="dyslexia", choices=["dyslexia", "dysgraphia", "dyscalculia"])
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=5e-4)
    parser.add_argument("--text-language", default="bengali", choices=["bengali", "hindi", "english", "multilingual"])
    parser.add_argument("--freeze-foundation", action="store_true")
    parser.add_argument("--checkpoint", default="")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    data_config = DataConfig(text_language=args.text_language)
    dataset = DyslexiaManifestDataset(args.manifest, config=data_config)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True)

    foundation = BengaliLearningDisorderFoundationModel(data_config=data_config)
    foundation_ckpt = Path(args.foundation_checkpoint)
    if foundation_ckpt.exists():
        payload = torch.load(foundation_ckpt, map_location="cpu")
        foundation.load_state_dict(payload["model_state"], strict=False)
    adapter = LearningDisorderAdapter(foundation=foundation, disorder=args.disorder, num_classes=3).to(device)

    if args.freeze_foundation:
        for parameter in adapter.foundation.parameters():
            parameter.requires_grad = False

    optimizer = torch.optim.AdamW((p for p in adapter.parameters() if p.requires_grad), lr=args.learning_rate, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss()

    adapter.train()
    for epoch in range(1, args.epochs + 1):
        total_loss = 0.0
        total = 0
        correct = 0
        for batch in loader:
            image = batch["image"].to(device)
            audio = batch["audio"].to(device)
            text = batch["text"].to(device)
            errors = batch["errors"].to(device)
            behavior = batch["behavior"].to(device)
            target = select_target(batch, args.disorder).to(device)

            logits = adapter(image, audio, text, errors, behavior)
            loss = criterion(logits, target)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()

            total_loss += float(loss.detach().cpu().item())
            pred = logits.argmax(dim=1)
            correct += int((pred == target).sum().item())
            total += int(target.numel())

        avg_loss = total_loss / max(1, len(loader))
        accuracy = correct / max(1, total)
        print(f"Epoch {epoch}/{args.epochs} | loss={avg_loss:.4f} | accuracy={accuracy:.4f}", flush=True)

    checkpoint_path = args.checkpoint or f"checkpoints/foundation/{args.disorder}_adapter.pt"
    destination = Path(checkpoint_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "adapter_state": adapter.state_dict(),
            "disorder": args.disorder,
            "data_config": data_config.__dict__,
            "model_name": "learning_disorder_adapter",
        },
        destination,
    )
    print(f"Saved adapter checkpoint to {destination}", flush=True)


if __name__ == "__main__":
    main()
