from __future__ import annotations

import io
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from flask import Flask, jsonify, render_template, request, send_from_directory

from src.dyslexia_detection.biomarkers import discover_digital_biomarkers
from src.dyslexia_detection.config import DataConfig
from src.dyslexia_detection.educational_explanations import build_educational_explanation
from src.dyslexia_detection.eye_tracking import compute_eye_tracking_metrics
from src.dyslexia_detection.intervention import (
    InterventionPolicy,
    InterventionProfile,
    SEVERITY_NAME_TO_LEVEL,
    build_intervention_plan,
)
from src.dyslexia_detection.models import build_model
from src.dyslexia_detection.preprocessing import (
    build_char_vocab,
    encode_text,
    extract_audio_features,
    load_handwriting_image,
)
from src.dyslexia_detection.speech_therapy import score_therapy_session


RISK_LABELS = {0: "Low risk", 1: "Elevated risk"}
SEVERITY_LABELS = {0: "Mild", 1: "Moderate", 2: "Severe"}

FRONTEND_DIST = Path("frontend/dist")
if FRONTEND_DIST.exists():
    app = Flask(__name__, static_folder=str(FRONTEND_DIST), static_url_path="/")
else:
    app = Flask(__name__, template_folder="webapp/templates", static_folder="webapp/static")


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


def _get_model(checkpoint_path: str = "checkpoints/best_model.pt") -> torch.nn.Module:
    checkpoint = Path(checkpoint_path)
    model = build_model("multimodal", DataConfig())
    if checkpoint.exists():
        payload = torch.load(checkpoint, map_location="cpu")
        cfg = payload.get("data_config", DataConfig())
        if isinstance(cfg, dict):
            cfg = DataConfig(**cfg)
        num_classes = int(payload.get("num_classes", 2))
        model = build_model(payload.get("model_name", "multimodal"), cfg, num_classes=num_classes)
        model.load_state_dict(payload["model_state"])
    model.eval()
    return model


MODEL = _get_model()


def _label_from_probabilities(probabilities: np.ndarray) -> str:
    idx = int(np.argmax(probabilities))
    if probabilities.shape[0] == 3:
        return SEVERITY_LABELS.get(idx, f"Class {idx}")
    return RISK_LABELS.get(idx, f"Class {idx}")


def _predict(
    image_path: Path | None,
    audio_path: Path | None,
    text_sample: str,
    spelling_errors: int,
    pronunciation_errors: int,
    reading_time_seconds: float,
    hesitation_count: int,
    repetition_count: int,
    omission_count: int,
    sample_language: str,
    model_text_language: str,
) -> tuple[float, np.ndarray]:
    cfg = DataConfig()
    vocab = build_char_vocab(model_text_language)
    image = torch.tensor(load_handwriting_image(image_path, cfg), dtype=torch.float32).unsqueeze(0)
    audio = torch.tensor(extract_audio_features(audio_path, cfg), dtype=torch.float32).unsqueeze(0)
    text = torch.tensor(encode_text(text_sample, vocab, cfg.max_text_length, sample_language), dtype=torch.long).unsqueeze(0)
    errors = torch.tensor([[spelling_errors, pronunciation_errors]], dtype=torch.float32)
    behavior = torch.tensor([[reading_time_seconds, hesitation_count, repetition_count, omission_count]], dtype=torch.float32)
    with torch.no_grad():
        probabilities = torch.softmax(MODEL(image, audio, text, errors, behavior), dim=1).squeeze(0).numpy()
    confidence = float(np.max(probabilities))
    return confidence, probabilities


@app.get("/")
def index():
    if FRONTEND_DIST.exists():
        return send_from_directory(app.static_folder, "index.html")
    return render_template("index.html")


@app.get("/api/health")
def api_health():
    return jsonify({"status": "ok"})


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def api_options(_path: str):
    return ("", 204)


@app.post("/api/screen")
def api_screen():
    if request.content_type and "multipart/form-data" in request.content_type:
        payload = request.form.to_dict()
    else:
        payload = request.get_json(force=True)

    sample_language = payload.get("sample_language", "Bengali")
    model_text_language = payload.get("model_text_language", "bengali")

    image_path: Path | None = None
    audio_path: Path | None = None
    temp_paths: list[Path] = []
    try:
        handwriting = request.files.get("handwriting_file")
        if handwriting and handwriting.filename:
            suffix = Path(handwriting.filename).suffix or ".png"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                handwriting.save(handle.name)
                image_path = Path(handle.name)
                temp_paths.append(image_path)

        audio_file = request.files.get("audio_file")
        if audio_file and audio_file.filename:
            suffix = Path(audio_file.filename).suffix or ".wav"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                audio_file.save(handle.name)
                audio_path = Path(handle.name)
                temp_paths.append(audio_path)

        confidence, probabilities = _predict(
            image_path=image_path,
            audio_path=audio_path,
            text_sample=str(payload.get("text_sample", "ami bangla pori")),
            spelling_errors=int(payload.get("spelling_errors", 0)),
            pronunciation_errors=int(payload.get("pronunciation_errors", 0)),
            reading_time_seconds=float(payload.get("reading_time_seconds", 0.0)),
            hesitation_count=int(payload.get("hesitation_count", 0)),
            repetition_count=int(payload.get("repetition_count", 0)),
            omission_count=int(payload.get("omission_count", 0)),
            sample_language=sample_language,
            model_text_language=model_text_language,
        )
        label_text = _label_from_probabilities(probabilities)
        explanation = build_educational_explanation(
            label_text=label_text,
            confidence=confidence,
            probabilities=probabilities,
            spelling_errors=int(payload.get("spelling_errors", 0)),
            pronunciation_errors=int(payload.get("pronunciation_errors", 0)),
            reading_time_seconds=float(payload.get("reading_time_seconds", 0.0)),
            hesitation_count=int(payload.get("hesitation_count", 0)),
            repetition_count=int(payload.get("repetition_count", 0)),
            omission_count=int(payload.get("omission_count", 0)),
            sample_language=sample_language,
            modality_attention=None,
        )
        severity_level = SEVERITY_NAME_TO_LEVEL.get(label_text.lower(), 1)
        profile = InterventionProfile(
            language=sample_language,
            severity_level=int(severity_level),
            spelling_errors=int(payload.get("spelling_errors", 0)),
            pronunciation_errors=int(payload.get("pronunciation_errors", 0)),
            reading_time_seconds=float(payload.get("reading_time_seconds", 0.0)),
            hesitation_count=int(payload.get("hesitation_count", 0)),
            repetition_count=int(payload.get("repetition_count", 0)),
            omission_count=int(payload.get("omission_count", 0)),
        )
        plan = build_intervention_plan(profile, InterventionPolicy.load_or_create("data/collection/intervention/policy.json"))
        return jsonify(
            {
                "label": label_text,
                "confidence": confidence,
                "probabilities": probabilities.tolist(),
                "explanation": {
                    "summary": explanation.summary,
                    "teacher": explanation.teacher,
                    "parent": explanation.parent,
                    "student": explanation.student,
                    "next_steps": explanation.next_steps,
                },
                "intervention": {
                    "reading": plan.reading_exercise,
                    "pronunciation": plan.pronunciation_exercise,
                    "spelling": plan.spelling_exercise,
                    "weekly_target_minutes": plan.weekly_target_minutes,
                    "notes": plan.notes,
                },
            }
        )
    finally:
        for path in temp_paths:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass


@app.post("/api/therapy/score")
def api_therapy_score():
    payload = request.get_json(force=True)
    result = score_therapy_session(
        float(payload.get("duration_seconds", 0.0)),
        int(payload.get("pronunciation_errors", 0)),
        int(payload.get("syllable_repetitions", 0)),
        int(payload.get("sound_substitutions", 0)),
        int(payload.get("attention_rating", 3)),
    )
    return jsonify({"therapy_score": result.therapy_score, "recommendation": result.recommendation, "next_level": result.next_level})


@app.post("/api/eye/metrics")
def api_eye_metrics():
    if "trace_file" not in request.files:
        return jsonify({"error": "trace_file missing"}), 400
    word_count = int(request.form.get("word_count", 1))
    raw = request.files["trace_file"].read()
    frame = pd.read_csv(io.BytesIO(raw))
    metrics = compute_eye_tracking_metrics(frame, word_count=word_count)
    return jsonify(metrics.__dict__)


@app.post("/api/biomarkers")
def api_biomarkers():
    payload = request.get_json(force=True)
    manifest = Path(str(payload.get("manifest_path", "data/demo/audio_augmented_manifest.csv")))
    if not manifest.exists():
        return jsonify({"error": f"Manifest not found: {manifest}"}), 400
    result = discover_digital_biomarkers(manifest)
    top = result.summary.head(15).replace({np.nan: None}).to_dict(orient="records")
    return jsonify({"top_biomarkers": top, "rows": int(len(result.dataset))})


@app.get("/<path:path>")
def static_proxy(path: str):
    if FRONTEND_DIST.exists():
        requested = FRONTEND_DIST / path
        if requested.exists() and requested.is_file():
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, "index.html")
    return ("Not Found", 404)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=False)
