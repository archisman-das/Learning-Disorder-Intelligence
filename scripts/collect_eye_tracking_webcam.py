from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dyslexia_detection.eye_tracking import append_eye_tracking_metrics, compute_eye_tracking_metrics


def detect_gaze_point(gray: np.ndarray, face_cascade, eye_cascade) -> tuple[float, float] | None:
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=4, minSize=(80, 80))
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda item: item[2] * item[3])
    face_roi = gray[y : y + h, x : x + w]
    eyes = eye_cascade.detectMultiScale(face_roi, scaleFactor=1.12, minNeighbors=3, minSize=(18, 18))
    if len(eyes) == 0:
        return None
    centers = []
    for ex, ey, ew, eh in eyes[:2]:
        centers.append((x + ex + (ew / 2.0), y + ey + (eh / 2.0)))
    if not centers:
        return None
    cx = float(np.mean([center[0] for center in centers]))
    cy = float(np.mean([center[1] for center in centers]))
    gx = cx / float(gray.shape[1])
    gy = cy / float(gray.shape[0])
    return gx, gy


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect webcam-based eye-tracking dataset for Bengali reading tasks.")
    parser.add_argument("--sample-id", required=True)
    parser.add_argument("--participant-hash", default="anon_user_001")
    parser.add_argument("--language", default="Bengali")
    parser.add_argument("--prompt", default="আমি বাংলা পড়ি")
    parser.add_argument("--word-count", type=int, default=4)
    parser.add_argument("--output-dir", default="data/collection/eye_tracking")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--max-seconds", type=float, default=45.0)
    args = parser.parse_args()

    face_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    eye_path = cv2.data.haarcascades + "haarcascade_eye.xml"
    face_cascade = cv2.CascadeClassifier(face_path)
    eye_cascade = cv2.CascadeClassifier(eye_path)

    capture = cv2.VideoCapture(args.camera)
    if not capture.isOpened():
        raise SystemExit(f"Could not open camera index {args.camera}")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    trace_rows: list[dict[str, float]] = []
    start = time.time()

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gaze = detect_gaze_point(gray, face_cascade, eye_cascade)
        elapsed = (time.time() - start) * 1000.0
        if gaze is not None:
            gx, gy = gaze
            trace_rows.append({"timestamp_ms": elapsed, "gaze_x": gx, "gaze_y": gy})
            px = int(gx * frame.shape[1])
            py = int(gy * frame.shape[0])
            cv2.circle(frame, (px, py), 5, (0, 255, 0), -1)

        cv2.putText(frame, f"Prompt: {args.prompt}", (12, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255, 255, 255), 2)
        cv2.putText(frame, "Press q to finish", (12, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255, 255, 255), 2)
        cv2.imshow("Bengali Eye Tracking Collection", frame)
        if (time.time() - start) >= args.max_seconds:
            break
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    capture.release()
    cv2.destroyAllWindows()

    trace = pd.DataFrame(trace_rows, columns=["timestamp_ms", "gaze_x", "gaze_y"])
    trace_path = output_dir / f"{args.sample_id}_gaze_trace.csv"
    trace.to_csv(trace_path, index=False)
    metrics = compute_eye_tracking_metrics(trace, word_count=args.word_count)
    metrics_path = append_eye_tracking_metrics(
        output_dir / "eye_tracking_metrics.csv",
        sample_id=args.sample_id,
        participant_hash=args.participant_hash,
        language=args.language,
        metrics=metrics,
        word_count=args.word_count,
    )

    print(f"Saved gaze trace: {trace_path}")
    print(f"Saved metrics: {metrics_path}")
    print(
        "metrics "
        f"fixation_duration_ms={metrics.fixation_duration_ms:.2f} "
        f"regressions_count={metrics.regressions_count} "
        f"reading_speed_wpm={metrics.reading_speed_wpm:.2f} "
        f"gaze_dispersion={metrics.gaze_dispersion:.4f} "
        f"scanpath_length={metrics.scanpath_length:.4f} "
        f"mean_saccade_velocity={metrics.mean_saccade_velocity:.4f}"
    )


if __name__ == "__main__":
    main()
