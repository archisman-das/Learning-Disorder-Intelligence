from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.dataset_tools import append_manifest_row


def copy_asset(source: str, destination: Path) -> str:
    if not source:
        return ""
    source_path = Path(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_path, destination)
    return os.path.relpath(destination, destination.parents[2])


def main() -> None:
    parser = argparse.ArgumentParser(description="Add one collected handwriting/text/audio sample to a manifest.")
    parser.add_argument("--workspace", default="data/collection")
    parser.add_argument("--sample-id", required=True)
    parser.add_argument("--student-hash", required=True)
    parser.add_argument("--handwriting-file", default="")
    parser.add_argument("--audio-file", default="")
    parser.add_argument("--text-sample", required=True)
    parser.add_argument("--spelling-errors", type=int, default=0)
    parser.add_argument("--pronunciation-errors", type=int, default=0)
    parser.add_argument("--reading-time-seconds", type=float, default=0.0)
    parser.add_argument("--hesitation-count", type=int, default=0)
    parser.add_argument("--repetition-count", type=int, default=0)
    parser.add_argument("--omission-count", type=int, default=0)
    parser.add_argument("--label", type=int, choices=[0, 1], default=0)
    parser.add_argument("--guardian-consent", default="yes")
    parser.add_argument("--student-assent", default="yes")
    parser.add_argument("--data-use-scope", default="research")
    parser.add_argument("--language", default="Bengali")
    args = parser.parse_args()

    workspace = Path(args.workspace)
    manifest = workspace / "manifest.csv"
    handwriting_path = copy_asset(
        args.handwriting_file,
        workspace / "raw" / "handwriting" / f"{args.sample_id}{Path(args.handwriting_file).suffix or '.png'}",
    )
    audio_path = copy_asset(
        args.audio_file,
        workspace / "raw" / "audio" / f"{args.sample_id}{Path(args.audio_file).suffix or '.wav'}",
    )
    append_manifest_row(
        manifest,
        {
            "sample_id": args.sample_id,
            "student_hash": args.student_hash,
            "handwriting_path": handwriting_path,
            "audio_path": audio_path,
            "text_sample": args.text_sample,
            "spelling_errors": args.spelling_errors,
            "pronunciation_errors": args.pronunciation_errors,
            "reading_time_seconds": args.reading_time_seconds,
            "hesitation_count": args.hesitation_count,
            "repetition_count": args.repetition_count,
            "omission_count": args.omission_count,
            "guardian_consent": args.guardian_consent,
            "student_assent": args.student_assent,
            "data_use_scope": args.data_use_scope,
            "language": args.language,
            "label": args.label,
        },
    )
    print(f"Sample added to {manifest}")


if __name__ == "__main__":
    main()
