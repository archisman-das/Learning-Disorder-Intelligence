from __future__ import annotations

import json
import os
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile

from flask import Flask, jsonify, make_response, send_from_directory, request

BASE_DIR = Path(__file__).resolve().parent
WEB_ROOT = BASE_DIR / "web"
WHISPER_MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")
_WHISPER_MODEL = None
_WHISPER_MODEL_KEY = None
_FFMPEG_READY = False
_WEB_API = None
_CHECKPOINTS_DIR = BASE_DIR / "checkpoints"
_MODEL_STATS_ASSET_PATH = WEB_ROOT / "assets" / "model-statistics.json"
_MODEL_STATS_VISIBLE_MODELS = {"multimodal_attention", "transformer", "vit"}


def _load_json_file(path: Path) -> dict[str, object] | None:
    try:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        return loaded if isinstance(loaded, dict) else None
    except Exception:
        return None


def _first_existing_path(*candidates: Path) -> Path | None:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _summarize_cv_summary(summary: dict[str, object], model_name: str) -> dict[str, object]:
    return {
        "model": str(summary.get("model", model_name) or model_name),
        "manifest": summary.get("manifest"),
        "folds": summary.get("folds"),
        "repeats": summary.get("repeats"),
        "mean_best_accuracy": summary.get("mean_best_accuracy"),
        "std_best_accuracy": summary.get("std_best_accuracy"),
        "mean_best_precision": summary.get("mean_best_precision"),
        "std_best_precision": summary.get("std_best_precision"),
        "mean_best_recall": summary.get("mean_best_recall"),
        "std_best_recall": summary.get("std_best_recall"),
        "mean_best_f1": summary.get("mean_best_f1"),
        "std_best_f1": summary.get("std_best_f1"),
        "mean_best_score": summary.get("mean_best_score"),
        "std_best_score": summary.get("std_best_score"),
        "mean_best_balanced_accuracy": summary.get("mean_best_balanced_accuracy"),
        "std_best_balanced_accuracy": summary.get("std_best_balanced_accuracy"),
        "mean_best_decision_threshold": summary.get("mean_best_decision_threshold"),
        "std_best_decision_threshold": summary.get("std_best_decision_threshold"),
    }


def _is_visible_model(model_name: object) -> bool:
    return str(model_name or "").lower() in _MODEL_STATS_VISIBLE_MODELS


def _selection_value_from_summary(summary: dict[str, object]) -> float:
    f1 = float(summary.get("mean_best_f1") or 0.0)
    accuracy = float(summary.get("mean_best_accuracy") or 0.0)
    precision = float(summary.get("mean_best_precision") or 0.0)
    return (0.5 * f1) + (0.3 * accuracy) + (0.2 * precision)


def _load_model_statistics_summary() -> dict[str, object]:
    bundled_summary = _load_json_file(_MODEL_STATS_ASSET_PATH)
    if bundled_summary:
        bundled_summary["generatedAt"] = datetime.now().isoformat(timespec="seconds")
        return bundled_summary

    selection_summary_path = _CHECKPOINTS_DIR / "selection_holdout_long_retrain" / "selection_and_holdout_summary.json"
    selection_summary = _load_json_file(selection_summary_path)

    cv_summaries: list[dict[str, object]] = []
    cv_root = selection_summary_path.parent / "cv"
    if cv_root.exists():
        for summary_path in sorted(cv_root.rglob("cross_validation_summary.json")):
            summary = _load_json_file(summary_path)
            if not summary:
                continue
            model_name = str(summary.get("model") or summary_path.parent.name)
            if not _is_visible_model(model_name):
                continue
            cv_summaries.append(_summarize_cv_summary(summary, model_name))

    desired_order = ["multimodal_attention", "transformer", "vit"]
    visible_cv_by_model = {
        str(summary.get("model") or "").lower(): summary
        for summary in cv_summaries
        if _is_visible_model(summary.get("model"))
    }

    holdout_summary: dict[str, object] | None = None
    if selection_summary:
        holdout_path = selection_summary.get("holdout_summary_path")
        if holdout_path:
            holdout_summary = _load_json_file((BASE_DIR / str(holdout_path)).resolve()) or _load_json_file(Path(str(holdout_path)))
        if holdout_summary is None:
            maybe_holdout_metrics = selection_summary.get("holdout_metrics")
            holdout_summary = maybe_holdout_metrics if isinstance(maybe_holdout_metrics, dict) else None

    ordered_ranked_models: list[dict[str, object]] = []
    if selection_summary:
        ranked_models = selection_summary.get("ranked_models")
        ranked_map = {
            str(row.get("model") or "").lower(): row
            for row in ranked_models
            if isinstance(row, dict)
        } if isinstance(ranked_models, list) else {}

        for index, model_name in enumerate(desired_order, start=1):
            row = ranked_map.get(model_name)
            if row is not None:
                ordered_ranked_models.append(
                    {
                        "model": row.get("model"),
                        "selection_value": row.get("selection_value"),
                        "rank": index,
                        "summary_path": row.get("summary_path"),
                    }
                )

        if not ordered_ranked_models:
            for index, model_name in enumerate(desired_order, start=1):
                summary = visible_cv_by_model.get(model_name)
                if not summary:
                    continue
                ordered_ranked_models.append(
                    {
                        "model": summary.get("model"),
                        "selection_value": _selection_value_from_summary(summary),
                        "rank": index,
                        "summary_path": None,
                    }
                )

    if selection_summary:
        selection_pipeline = {
            "manifest": selection_summary.get("manifest"),
            "task": selection_summary.get("task"),
            "text_language": selection_summary.get("text_language"),
            "selection_metric": selection_summary.get("selection_metric"),
            "selected_model": selection_summary.get("selected_model"),
            "selection_value": selection_summary.get("selection_value"),
            "best_alias_path": selection_summary.get("best_alias_path"),
            "ranked_models": ordered_ranked_models or selection_summary.get("ranked_models") or [],
            "holdout_metrics": selection_summary.get("holdout_metrics"),
        }
        if selection_pipeline["ranked_models"]:
            selection_pipeline["ranked_models"] = [
                row
                for row in selection_pipeline["ranked_models"]
                if isinstance(row, dict) and _is_visible_model(row.get("model"))
            ]
    else:
        selection_pipeline = {
            "manifest": None,
            "task": None,
            "text_language": None,
            "selection_metric": None,
            "selected_model": None,
            "selection_value": None,
            "best_alias_path": None,
            "ranked_models": [],
            "holdout_metrics": None,
        }

    if selection_pipeline.get("ranked_models"):
        selection_pipeline["ranked_models"] = [
            {
                "model": row.get("model"),
                "selection_value": row.get("selection_value"),
                "rank": index,
                "summary_path": row.get("summary_path"),
            }
            for index, row in enumerate(selection_pipeline["ranked_models"], start=1)
        ]
        if selection_pipeline.get("selection_value") is None:
            selection_pipeline["selection_value"] = selection_pipeline["ranked_models"][0].get("selection_value")

    selection_history: list[dict[str, object]] = []
    if selection_summary:
        selection_history.append(
            {
                "source": selection_summary_path.parent.name,
                "selected_model": selection_summary.get("selected_model"),
                "selection_metric": selection_summary.get("selection_metric"),
                "selection_value": selection_summary.get("selection_value"),
                "best_alias_path": selection_summary.get("best_alias_path"),
                "ranked_models": selection_pipeline.get("ranked_models") or [],
                "summary": f"Selected {selection_summary.get('selected_model') or 'unknown'} using {selection_summary.get('selection_metric') or 'selection metric'}",
            }
        )

    cv_summaries = [
        summary
        for summary in cv_summaries
        if _is_visible_model(summary.get("model"))
    ]
    visible_order = {model_name: index for index, model_name in enumerate(desired_order)}
    cv_summaries.sort(
        key=lambda summary: (
            visible_order.get(str(summary.get("model") or "").lower(), len(desired_order)),
            str(summary.get("model") or ""),
        )
    )

    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "benchmarkSource": selection_summary_path.parent.name if selection_summary else "unknown",
        "selectionPipeline": selection_pipeline,
        "selectionHistory": selection_history,
        "validationVsHoldout": {
            "cvSummaries": cv_summaries,
            "holdoutSummary": holdout_summary,
        },
        "thresholdLogs": {},
    }


def _suffix_from_request(content_type: str, filename: str) -> str:
    name = (filename or "").strip().lower()
    if name.endswith(".ogg"):
        return ".ogg"
    if name.endswith(".mp4") or name.endswith(".m4a"):
        return ".mp4"
    lowered = (content_type or "").split(";", 1)[0].strip().lower()
    if "ogg" in lowered:
        return ".ogg"
    if "mp4" in lowered or "mpeg" in lowered:
        return ".mp4"
    return ".webm"


def _ensure_ffmpeg_on_path() -> None:
    global _FFMPEG_READY
    if _FFMPEG_READY:
        return

    search_roots = [
        Path.home() / "AppData" / "Local" / "Microsoft" / "WinGet" / "Packages",
        Path.home() / "scoop" / "apps",
    ]
    for root in search_roots:
        if not root.exists():
            continue
        for candidate in root.rglob("ffmpeg.exe"):
            bin_dir = str(candidate.parent)
            current_path = os.environ.get("PATH", "")
            if bin_dir not in current_path.split(os.pathsep):
                os.environ["PATH"] = f"{bin_dir}{os.pathsep}{current_path}" if current_path else bin_dir
            _FFMPEG_READY = True
            return


def _load_whisper_model():
    global _WHISPER_MODEL, _WHISPER_MODEL_KEY
    if _WHISPER_MODEL is not None and _WHISPER_MODEL_KEY == WHISPER_MODEL_NAME:
        return _WHISPER_MODEL
    import whisper

    _WHISPER_MODEL = whisper.load_model(WHISPER_MODEL_NAME)
    _WHISPER_MODEL_KEY = WHISPER_MODEL_NAME
    return _WHISPER_MODEL


def _load_web_api():
    global _WEB_API
    if _WEB_API is None:
        from src.dyslexia_detection import web_api as _web_api

        _WEB_API = _web_api
    return _WEB_API


def _transcribe_audio(path: Path, language: str | None) -> str:
    _ensure_ffmpeg_on_path()
    model = _load_whisper_model()
    options: dict[str, object] = {"task": "transcribe", "fp16": False}
    if language:
        options["language"] = language
    result = model.transcribe(str(path), **options)
    return str(result.get("text", "")).strip()


def create_app() -> Flask:
    app = Flask(__name__, static_folder=str(WEB_ROOT), static_url_path="")

    @app.after_request
    def add_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        origin = request.headers.get("Origin")
        if origin:
          response.headers["Access-Control-Allow-Origin"] = origin
          response.headers["Vary"] = "Origin"
          response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
          response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Reading-Language, X-Audio-Filename"
        return response

    @app.get("/healthz")
    def healthz():
        return jsonify({"status": "ok", "service": "dyslexia-detection-web"})

    @app.post("/api/reading-transcribe")
    def reading_transcribe():
        payload = request.get_data(cache=False)
        if not payload:
            return jsonify({"error": "No audio payload was received."}), 400

        language_map = {
            "bengali": "bn",
            "english": "en",
            "multilingual": None,
        }
        requested_language = language_map.get((request.headers.get("X-Reading-Language", "") or "").strip().lower())
        suffix = _suffix_from_request(
            request.headers.get("Content-Type", ""),
            request.headers.get("X-Audio-Filename", ""),
        )

        temp_path: Path | None = None
        try:
            with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                temp_file.write(payload)
                temp_path = Path(temp_file.name)
            transcript = _transcribe_audio(temp_path, requested_language)
            return jsonify(
                {
                    "text": transcript,
                    "engine": f"Whisper {WHISPER_MODEL_NAME}",
                    "word_count": len(transcript.split()),
                }
            )
        except ModuleNotFoundError:
            return (
                jsonify(
                    {
                        "error": "Whisper is not installed locally. Run `python -m pip install openai-whisper` and restart the dashboard.",
                    }
                ),
                503,
            )
        except Exception as exc:
            return jsonify({"error": f"Whisper transcription failed: {exc}"}), 500
        finally:
            if temp_path is not None:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass

    @app.post("/api/screen")
    def screen():
        web_api = _load_web_api()
        file_keys = {"handwriting_file", "audio_file"}
        has_uploaded_media = any(key in request.files and request.files[key].filename for key in file_keys)

        try:
            if has_uploaded_media:
                handwriting = request.files.get("handwriting_file")
                audio = request.files.get("audio_file")
                form = request.form
                text_sample = form.get("text_sample", "") or ""
                sample_language = form.get("sample_language", "Bengali") or "Bengali"
                model_text_language = form.get("model_text_language", "bengali") or "bengali"
                try:
                    result = web_api.predict_screening_from_files(
                        handwriting_bytes=handwriting.read() if handwriting and handwriting.filename else None,
                        handwriting_filename=handwriting.filename if handwriting else None,
                        audio_bytes=audio.read() if audio and audio.filename else None,
                        audio_filename=audio.filename if audio else None,
                        text_sample=text_sample,
                        spelling_errors=int(float(form.get("spelling_errors", 0) or 0)),
                        pronunciation_errors=int(float(form.get("pronunciation_errors", 0) or 0)),
                        reading_time_seconds=float(form.get("reading_time_seconds", 0) or 0),
                        hesitation_count=int(float(form.get("hesitation_count", 0) or 0)),
                        repetition_count=int(float(form.get("repetition_count", 0) or 0)),
                        omission_count=int(float(form.get("omission_count", 0) or 0)),
                        sample_language=sample_language,
                        model_text_language=model_text_language,
                    )
                    return jsonify(result)
                except FileNotFoundError:
                    return jsonify(web_api.summarize_live_screening_payload(form.to_dict(flat=True)))

            payload = request.get_json(silent=True)
            if payload is None:
                payload = request.form.to_dict(flat=True)
            result = web_api.summarize_live_screening_payload(payload)
            return jsonify(result)
        except Exception as exc:
            return jsonify({"error": f"Screening failed: {exc}"}), 500

    @app.post("/api/comparison")
    def comparison():
        web_api = _load_web_api()
        payload = request.get_json(silent=True) or request.form.to_dict(flat=True)
        try:
            result = web_api.summarize_comparison_payload(payload)
            return jsonify(result)
        except Exception as exc:
            return jsonify({"error": f"Comparison failed: {exc}"}), 500

    @app.post("/api/final-report")
    def final_report():
        web_api = _load_web_api()
        payload = request.get_json(silent=True) or request.form.to_dict(flat=True)
        try:
            result = web_api.summarize_final_report_payload(payload)
            return jsonify(result)
        except Exception as exc:
            return jsonify({"error": f"Final report failed: {exc}"}), 500

    @app.get("/api/model-statistics")
    def model_statistics():
        try:
            return jsonify(_load_model_statistics_summary())
        except Exception as exc:
            return jsonify({"error": f"Model statistics failed: {exc}"}), 500

    @app.get("/", defaults={"path": "index.html"})
    @app.get("/<path:path>")
    def serve_spa(path: str):
        target = WEB_ROOT / path
        if target.is_file():
            return send_from_directory(WEB_ROOT, path)
        return send_from_directory(WEB_ROOT, "index.html")

    return app


app = create_app()


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":
    main()
