from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.speech_therapy import (
    SPEECH_THERAPY_TASKS,
    append_therapy_session,
    create_therapy_workspace,
    estimate_wav_duration,
    score_therapy_session,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Record one Bengali speech-therapy practice session.")
    parser.add_argument("--workspace", default="data/mobile_collection/therapy")
    parser.add_argument("--student-hash", required=True)
    parser.add_argument("--task-id", default="bn_sentence_easy")
    parser.add_argument("--audio-file", default="")
    parser.add_argument("--pronunciation-errors", type=int, default=0)
    parser.add_argument("--syllable-repetitions", type=int, default=0)
    parser.add_argument("--sound-substitutions", type=int, default=0)
    parser.add_argument("--attention-rating", type=int, default=3)
    args = parser.parse_args()

    paths = create_therapy_workspace(args.workspace)
    task_lookup = {task.task_id: task for task in SPEECH_THERAPY_TASKS}
    if args.task_id not in task_lookup:
        valid = ", ".join(sorted(task_lookup))
        raise SystemExit(f"Unknown task-id '{args.task_id}'. Valid task IDs: {valid}")
    task = task_lookup[args.task_id]

    session_id = f"THER_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    audio_path = ""
    duration_seconds = 0.0
    if args.audio_file:
        source = Path(args.audio_file)
        if not source.exists():
            raise SystemExit(f"Audio file not found: {source}")
        destination = paths["audio"] / f"{session_id}{source.suffix or '.wav'}"
        shutil.copyfile(source, destination)
        audio_path = str(destination.relative_to(paths["root"]))
        duration_seconds = estimate_wav_duration(destination)

    result = score_therapy_session(
        duration_seconds,
        args.pronunciation_errors,
        args.syllable_repetitions,
        args.sound_substitutions,
        args.attention_rating,
    )
    append_therapy_session(
        paths["sessions"],
        {
            "session_id": session_id,
            "student_hash": args.student_hash,
            "task_id": task.task_id,
            "language": task.language,
            "level": task.level,
            "target_sound": task.target_sound,
            "prompt": task.prompt,
            "audio_path": audio_path,
            "duration_seconds": round(duration_seconds, 3),
            "pronunciation_errors": args.pronunciation_errors,
            "syllable_repetitions": args.syllable_repetitions,
            "sound_substitutions": args.sound_substitutions,
            "attention_rating": args.attention_rating,
            "therapy_score": result.therapy_score,
            "recommendation": result.recommendation,
        },
    )
    print(f"Saved {session_id} to {paths['sessions']}")
    print(f"Therapy score: {result.therapy_score:.1%}")
    print(f"Next step: {result.next_level}")
    print(result.recommendation)


if __name__ == "__main__":
    main()
