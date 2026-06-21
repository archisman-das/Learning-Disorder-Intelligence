from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import pandas as pd
import torch


SUPPORTED_MODELS = [
    "cnn",
    "lstm",
    "cnn_lstm",
    "transformer",
    "vit",
    "vit_transformer",
    "multimodal",
    "multimodal_attention",
]

MODEL_PRIORITY = {
    "multimodal_attention": 5,
    "transformer": 4,
    "vit": 3,
    "cnn": 2,
    "lstm": 1,
}

MODEL_PRIORITY_BONUS = {
    "multimodal_attention": 0.25,
    "transformer": 0.18,
    "vit": 0.16,
    "vit_transformer": 0.16,
    "cnn": 0.02,
    "cnn_lstm": 0.02,
    "lstm": -0.05,
}

MODEL_SEED_OFFSETS = {
    "multimodal_attention": 11,
    "transformer": 23,
    "vit": 37,
    "cnn": 41,
    "lstm": 53,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Select the best model with repeated cross-validation, then run a hard holdout test.")
    parser.add_argument("--manifest", required=True, help="Path to the prepared manifest CSV.")
    parser.add_argument("--task", default="binary", choices=["binary", "severity", "regression"])
    parser.add_argument("--text-language", default="multilingual", choices=["bengali", "english", "multilingual"])
    parser.add_argument("--models", nargs="+", default=["cnn_lstm", "transformer", "vit_transformer", "multimodal_attention"], choices=SUPPORTED_MODELS)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--label-smoothing", type=float, default=0.05)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--test-fraction", type=float, default=0.15)
    parser.add_argument("--checkpoint-root", default="checkpoints/model_selection")
    parser.add_argument("--save-fold-checkpoints", action="store_true")
    parser.add_argument("--save-splits", action="store_true")
    parser.add_argument("--pretrained-audio-encoder", default="")
    parser.add_argument("--transfer-checkpoint", default="")
    parser.add_argument("--transfer-prefixes", default="handwriting.,audio.,behavior.,classifier.")
    parser.add_argument("--freeze-transferred-epochs", type=int, default=0)
    parser.add_argument("--distill-checkpoint", default="")
    parser.add_argument("--distill-weight", type=float, default=0.0)
    parser.add_argument("--selection-metric", default="weighted_priority_score", help="Metric from cross-validation summary used to rank models.")
    parser.add_argument("--best-alias-path", default="checkpoints/best_model.pt", help="Path for a canonical best_model.pt alias that records the selected model name. Set to an empty string to disable.")
    parser.add_argument("--emit-json-line", action="store_true", help="Emit a single machine-readable JSON line with the selected model and alias path.")
    parser.add_argument("--quiet", action="store_true", help="Suppress subprocess logs and wrapper narration; useful with --emit-json-line.")
    return parser.parse_args()


def _run_command(command: list[str], quiet: bool = False) -> None:
    completed = subprocess.run(
        command,
        check=False,
        stdout=subprocess.PIPE if quiet else None,
        stderr=subprocess.PIPE if quiet else None,
        text=True if quiet else False,
    )
    if completed.returncode != 0:
        if quiet:
            if completed.stdout:
                print(completed.stdout, end="")
            if completed.stderr:
                print(completed.stderr, end="", file=sys.stderr)
        raise SystemExit(completed.returncode)


def _load_json(path: Path) -> dict[str, object]:
    if not path.exists():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


def _write_best_alias(alias_path: Path, source_checkpoint: Path, selected_model: str) -> None:
    alias_path.parent.mkdir(parents=True, exist_ok=True)
    payload = torch.load(source_checkpoint, map_location="cpu")
    payload["selected_model_name"] = selected_model
    payload["source_checkpoint"] = str(source_checkpoint)
    torch.save(payload, alias_path)


def _selection_value(summary: dict[str, object], metric_name: str, task: str) -> float:
    if metric_name == "weighted_priority_score":
        model_name = str(summary.get("model", "") or "").lower()
        base = (
            float(summary.get("mean_best_f1", 0.0)) * 0.5
            + float(summary.get("mean_best_accuracy", 0.0)) * 0.3
            + float(summary.get("mean_best_precision", 0.0)) * 0.2
        )
        return base + float(MODEL_PRIORITY_BONUS.get(model_name, 0.0))
    value = summary.get(metric_name)
    if value is not None:
        return float(value)
    if task == "regression":
        return float(summary.get("mean_best_score", float("-inf")))
    return float(summary.get("mean_best_f1", summary.get("mean_best_score", float("-inf"))))


def main() -> None:
    args = parse_args()
    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        raise SystemExit(f"Manifest not found: {manifest_path}")

    base_root = Path(args.checkpoint_root)
    base_root.mkdir(parents=True, exist_ok=True)

    rank_rows: list[dict[str, object]] = []
    model_configs: dict[str, dict[str, object]] = {}
    priority_model_name = "multimodal_attention"
    baseline_models = [model_name for model_name in args.models if model_name != priority_model_name]
    priority_models = [model_name for model_name in args.models if model_name == priority_model_name]

    def run_model(model_name: str, *, teacher_checkpoint: str | None = None) -> None:
        cv_root = base_root / "cv" / model_name
        cv_root.mkdir(parents=True, exist_ok=True)
        model_learning_rate = args.learning_rate
        model_epochs = args.epochs
        model_patience = args.patience
        model_transfer_checkpoint = args.transfer_checkpoint
        model_distill_checkpoint = args.distill_checkpoint
        model_distill_weight = args.distill_weight
        model_freeze_epochs = args.freeze_transferred_epochs

        if model_name == priority_model_name and teacher_checkpoint:
            model_learning_rate = min(model_learning_rate, args.learning_rate * 0.7)
            model_epochs = max(model_epochs, args.epochs + 12)
            model_patience = max(model_patience, args.patience + 6)
            model_transfer_checkpoint = teacher_checkpoint
            model_distill_checkpoint = teacher_checkpoint
            model_distill_weight = max(model_distill_weight, 0.65)
            model_freeze_epochs = max(model_freeze_epochs, 2)

        model_configs[model_name] = {
            "epochs": model_epochs,
            "learning_rate": model_learning_rate,
            "patience": model_patience,
            "transfer_checkpoint": model_transfer_checkpoint,
            "distill_checkpoint": model_distill_checkpoint,
            "distill_weight": model_distill_weight,
            "freeze_transferred_epochs": model_freeze_epochs,
        }

        cv_command = [
            sys.executable,
            str(Path(__file__).resolve().parent / "train_cross_validation.py"),
            "--manifest",
            str(manifest_path),
            "--model",
            model_name,
            "--task",
            args.task,
            "--text-language",
            args.text_language,
            "--folds",
            str(args.folds),
            "--repeats",
            str(args.repeats),
            "--epochs",
            str(model_epochs),
            "--batch-size",
            str(args.batch_size),
            "--learning-rate",
            str(model_learning_rate),
            "--patience",
            str(model_patience),
            "--label-smoothing",
            str(args.label_smoothing),
            "--grad-clip-norm",
            str(args.grad_clip_norm),
            "--validation-fraction",
            str(args.validation_fraction),
            "--checkpoint-root",
            str(cv_root),
            "--transfer-prefixes",
            args.transfer_prefixes,
            "--seed",
            str(42 + MODEL_SEED_OFFSETS.get(model_name, 0)),
        ]
        if args.save_fold_checkpoints:
            cv_command.append("--save-fold-checkpoints")
        if args.pretrained_audio_encoder:
            cv_command.extend(["--pretrained-audio-encoder", args.pretrained_audio_encoder])
        if model_transfer_checkpoint:
            cv_command.extend(["--transfer-checkpoint", model_transfer_checkpoint])
        if model_freeze_epochs > 0:
            cv_command.extend(["--freeze-transferred-epochs", str(model_freeze_epochs)])
        if model_distill_checkpoint:
            cv_command.extend(["--distill-checkpoint", model_distill_checkpoint])
        if model_distill_weight > 0:
            cv_command.extend(["--distill-weight", str(model_distill_weight)])

        if not args.quiet:
            print(f"\n### Cross-validation: {model_name} ###", flush=True)
        _run_command(cv_command, quiet=args.quiet)
        summary_path = cv_root / "cross_validation_summary.json"
        summary = _load_json(summary_path)
        selection_value = _selection_value(summary, args.selection_metric, args.task)
        rank_rows.append(
            {
                "model": model_name,
                "selection_value": selection_value,
                "summary_path": str(summary_path),
                "summary": summary,
            }
        )

    teacher_checkpoint: str | None = None
    for model_name in baseline_models:
        run_model(model_name)

    baseline_ranked = sorted(
        [row for row in rank_rows if str(row["model"]) != priority_model_name],
        key=lambda row: (
            float(row["selection_value"]),
            MODEL_PRIORITY.get(str(row["model"]), 0),
        ),
        reverse=True,
    )
    if baseline_ranked:
        teacher_model = str(baseline_ranked[0]["model"])
        teacher_config = model_configs.get(teacher_model, {})
        teacher_holdout_root = base_root / "teacher" / teacher_model
        teacher_holdout_root.mkdir(parents=True, exist_ok=True)
        teacher_holdout_command = [
            sys.executable,
            str(Path(__file__).resolve().parent / "train_holdout_evaluation.py"),
            "--manifest",
            str(manifest_path),
            "--model",
            teacher_model,
            "--task",
            args.task,
            "--text-language",
            args.text_language,
            "--epochs",
            str(teacher_config.get("epochs", args.epochs)),
            "--batch-size",
            str(args.batch_size),
            "--learning-rate",
            str(teacher_config.get("learning_rate", args.learning_rate)),
            "--validation-fraction",
            str(args.validation_fraction),
            "--test-fraction",
            str(args.test_fraction),
            "--patience",
            str(teacher_config.get("patience", args.patience)),
            "--label-smoothing",
            str(args.label_smoothing),
            "--grad-clip-norm",
            str(args.grad_clip_norm),
            "--checkpoint-dir",
            str(teacher_holdout_root),
            "--transfer-prefixes",
            args.transfer_prefixes,
            "--seed",
            str(242 + MODEL_SEED_OFFSETS.get(teacher_model, 0)),
        ]
        if args.pretrained_audio_encoder:
            teacher_holdout_command.extend(["--pretrained-audio-encoder", args.pretrained_audio_encoder])
        teacher_transfer_checkpoint = str(teacher_config.get("transfer_checkpoint", "") or "")
        teacher_distill_checkpoint = str(teacher_config.get("distill_checkpoint", "") or "")
        teacher_distill_weight = float(teacher_config.get("distill_weight", args.distill_weight))
        teacher_freeze_epochs = int(teacher_config.get("freeze_transferred_epochs", args.freeze_transferred_epochs))
        if teacher_transfer_checkpoint:
            teacher_holdout_command.extend(["--transfer-checkpoint", teacher_transfer_checkpoint])
        if teacher_freeze_epochs > 0:
            teacher_holdout_command.extend(["--freeze-transferred-epochs", str(teacher_freeze_epochs)])
        if teacher_distill_checkpoint:
            teacher_holdout_command.extend(["--distill-checkpoint", teacher_distill_checkpoint])
        if teacher_distill_weight > 0:
            teacher_holdout_command.extend(["--distill-weight", str(teacher_distill_weight)])
        if not args.quiet:
            print(f"\n### Teacher holdout evaluation: {teacher_model} ###", flush=True)
        _run_command(teacher_holdout_command, quiet=args.quiet)
        teacher_checkpoint = str(teacher_holdout_root / "best_model.pt")

    for model_name in priority_models:
        run_model(model_name, teacher_checkpoint=teacher_checkpoint)

    ranked = sorted(
        rank_rows,
        key=lambda row: (
            float(row["selection_value"]),
            MODEL_PRIORITY.get(str(row["model"]), 0),
        ),
        reverse=True,
    )
    best = ranked[0]
    best_model = str(best["model"])
    best_config = model_configs.get(best_model, {})
    if not args.quiet:
        print(f"\nSelected model: {best_model} (selection_value={float(best['selection_value']):.4f})", flush=True)

    holdout_root = base_root / "holdout" / best_model
    holdout_root.mkdir(parents=True, exist_ok=True)
    holdout_command = [
        sys.executable,
        str(Path(__file__).resolve().parent / "train_holdout_evaluation.py"),
        "--manifest",
        str(manifest_path),
        "--model",
        best_model,
        "--task",
        args.task,
        "--text-language",
        args.text_language,
        "--epochs",
        str(best_config.get("epochs", args.epochs)),
        "--batch-size",
        str(args.batch_size),
        "--learning-rate",
        str(best_config.get("learning_rate", args.learning_rate)),
        "--validation-fraction",
        str(args.validation_fraction),
        "--test-fraction",
        str(args.test_fraction),
        "--patience",
        str(best_config.get("patience", args.patience)),
        "--label-smoothing",
        str(args.label_smoothing),
        "--grad-clip-norm",
        str(args.grad_clip_norm),
        "--checkpoint-dir",
        str(holdout_root),
        "--transfer-prefixes",
        args.transfer_prefixes,
        "--seed",
        str(142 + MODEL_SEED_OFFSETS.get(best_model, 0)),
    ]
    if args.save_splits:
        holdout_command.append("--save-splits")
    if args.pretrained_audio_encoder:
        holdout_command.extend(["--pretrained-audio-encoder", args.pretrained_audio_encoder])
    transfer_checkpoint = str(best_config.get("transfer_checkpoint", "") or "")
    distill_checkpoint = str(best_config.get("distill_checkpoint", "") or "")
    distill_weight = float(best_config.get("distill_weight", args.distill_weight))
    freeze_transferred_epochs = int(best_config.get("freeze_transferred_epochs", args.freeze_transferred_epochs))
    if transfer_checkpoint:
        holdout_command.extend(["--transfer-checkpoint", transfer_checkpoint])
    if freeze_transferred_epochs > 0:
        holdout_command.extend(["--freeze-transferred-epochs", str(freeze_transferred_epochs)])
    if distill_checkpoint:
        holdout_command.extend(["--distill-checkpoint", distill_checkpoint])
    if distill_weight > 0:
        holdout_command.extend(["--distill-weight", str(distill_weight)])

    if not args.quiet:
        print(f"\n### Holdout evaluation: {best_model} ###", flush=True)
    _run_command(holdout_command, quiet=args.quiet)

    holdout_summary_path = holdout_root / "holdout_summary.json"
    holdout_summary = _load_json(holdout_summary_path)
    alias_path = Path(args.best_alias_path).expanduser() if args.best_alias_path else None
    if alias_path is not None:
        _write_best_alias(alias_path, holdout_root / "best_model.pt", best_model)
    selection_report = {
        "manifest": str(manifest_path),
        "task": args.task,
        "text_language": args.text_language,
        "models": [str(row["model"]) for row in ranked],
        "selection_metric": args.selection_metric,
        "selected_model": best_model,
        "best_alias_path": str(alias_path) if alias_path is not None else "",
        "selection_value": float(best["selection_value"]),
        "ranked_models": [
            {
                "model": str(row["model"]),
                "selection_value": float(row["selection_value"]),
                "summary_path": row["summary_path"],
            }
            for row in ranked
        ],
        "holdout_summary_path": str(holdout_summary_path),
        "holdout_metrics": holdout_summary,
    }
    (base_root / "selection_and_holdout_summary.json").write_text(json.dumps(selection_report, indent=2), encoding="utf-8")
    pd.DataFrame(
        [
            {
                "model": row["model"],
                "selection_value": row["selection_value"],
            }
            for row in ranked
        ]
    ).to_csv(base_root / "model_ranking.csv", index=False)

    if args.emit_json_line:
        machine_readable = {
            "selected_model": best_model,
            "best_alias_path": str(alias_path) if alias_path is not None else "",
            "holdout_summary_path": str(holdout_summary_path),
            "selection_value": float(best["selection_value"]),
            "task": args.task,
            "text_language": args.text_language,
            "manifest": str(manifest_path),
        }
        print("JSON_RESULT " + json.dumps(machine_readable, separators=(",", ":")))
    elif not args.quiet:
        print("\nSelection summary:")
        print(f"selected_model={best_model}")
        print(f"holdout_summary_path={holdout_summary_path}")
        if alias_path is not None:
            print(f"best_alias_path={alias_path}")
        for key, value in holdout_summary.items():
            if isinstance(value, (int, float)):
                print(f"holdout_{key}={float(value):.4f}")


if __name__ == "__main__":
    main()
