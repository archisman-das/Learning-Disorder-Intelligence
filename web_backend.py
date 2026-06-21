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


def _load_model_statistics_summary() -> dict[str, object]:
    selection_summary_path = _first_existing_path(
        _CHECKPOINTS_DIR / "hard_split_selection_balanced_harder_run2" / "strict_benchmark_summary.json",
        _CHECKPOINTS_DIR / "hard_split_selection_balanced_harder_run_proper" / "strict_benchmark_summary.json",
        _CHECKPOINTS_DIR / "selection_holdout_tough" / "selection_and_holdout_summary.json",
        _CHECKPOINTS_DIR / "selection_holdout_final" / "selection_and_holdout_summary.json",
        _CHECKPOINTS_DIR / "selection_holdout_smoke" / "selection_and_holdout_summary.json",
    )
    strict_summary_path = _first_existing_path(
        _CHECKPOINTS_DIR / "hard_split_selection_balanced_harder_run" / "strict_benchmark_summary.json",
        _CHECKPOINTS_DIR / "hard_split_selection_balanced_harder_run" / "seed_21" / "hard_split_selection_report.json",
        _CHECKPOINTS_DIR / "hard_split_selection_strict_run" / "hard_split_selection_report.json",
    )

    selection_summary = _load_json_file(selection_summary_path) if selection_summary_path else None
    strict_summary = _load_json_file(strict_summary_path) if strict_summary_path else None

    cv_summaries: list[dict[str, object]] = []
    cv_root = _CHECKPOINTS_DIR / "selection_holdout_tough" / "cv"
    if not cv_root.exists():
        cv_root = _CHECKPOINTS_DIR / "selection_holdout_final" / "cv"
    if cv_root.exists():
        for summary_path in sorted(cv_root.rglob("cross_validation_summary.json")):
            summary = _load_json_file(summary_path)
            if not summary:
                continue
            model_name = str(summary.get("model") or summary_path.parent.name)
            cv_summaries.append(_summarize_cv_summary(summary, model_name))

    strict_report: dict[str, object] | None = None
    if selection_summary_path and "hard_split_selection_balanced_harder_run" in str(selection_summary_path):
        runs = strict_summary.get("runs") or [] if strict_summary else []
        first_run = next((run for run in runs if isinstance(run, dict)), None) if isinstance(runs, list) else None
        report_path = str(first_run.get("report_path") or "") if first_run else ""
        if first_run and first_run.get("report_path"):
            strict_report = _load_json_file((BASE_DIR / str(first_run["report_path"])).resolve()) or _load_json_file(Path(str(first_run["report_path"])))
        if strict_report:
            ranking_rows = strict_report.get("ranking") if isinstance(strict_report.get("ranking"), list) else []
            selection_pipeline = {
                "manifest": strict_report.get("train_manifest"),
                "task": selection_summary.get("task") if selection_summary else None,
                "text_language": selection_summary.get("text_language") if selection_summary else None,
                "selection_metric": "score",
                "selected_model": strict_report.get("selected_model"),
                "selection_value": float(ranking_rows[0].get("selection_value", 0.0)) if ranking_rows else float((strict_report.get("final_eval_metrics") or {}).get("score", 0.0)),
                "best_alias_path": strict_report.get("best_alias_path"),
                "ranked_models": [
                    {
                        "model": row.get("model"),
                        "selection_value": row.get("selection_value"),
                        "rank": index + 1,
                        "summary_path": report_path,
                    }
                    for index, row in enumerate(ranking_rows if isinstance(ranking_rows, list) else [])
                ],
                "holdout_metrics": strict_report.get("final_eval_metrics"),
            }
            selection_summary = {
                "manifest": strict_report.get("train_manifest"),
                "task": selection_summary.get("task") if selection_summary else None,
                "text_language": selection_summary.get("text_language") if selection_summary else None,
                "selection_metric": "score",
                "selected_model": strict_report.get("selected_model"),
                "best_alias_path": strict_report.get("best_alias_path"),
                "selection_value": float(ranking_rows[0].get("selection_value", 0.0)) if ranking_rows else float((strict_report.get("final_eval_metrics") or {}).get("score", 0.0)),
                "ranked_models": selection_pipeline["ranked_models"],
                "holdout_metrics": strict_report.get("final_eval_metrics"),
            }
            if cv_summaries:
                final_metrics = strict_report.get("final_eval_metrics") or {}
                for summary in cv_summaries:
                    if str(summary.get("model") or "").lower() == str(strict_report.get("selected_model") or "").lower():
                        summary.update(
                            {
                                "manifest": strict_report.get("final_eval_manifest"),
                                "folds": 1,
                                "repeats": 1,
                                "mean_best_accuracy": final_metrics.get("accuracy"),
                                "std_best_accuracy": 0,
                                "mean_best_precision": final_metrics.get("precision"),
                                "std_best_precision": 0,
                                "mean_best_recall": final_metrics.get("recall"),
                                "std_best_recall": 0,
                                "mean_best_f1": final_metrics.get("f1"),
                                "std_best_f1": 0,
                                "mean_best_score": final_metrics.get("score"),
                                "std_best_score": 0,
                                "mean_best_balanced_accuracy": final_metrics.get("balanced_accuracy"),
                                "std_best_balanced_accuracy": 0,
                                "mean_best_decision_threshold": final_metrics.get("decision_threshold"),
                                "std_best_decision_threshold": 0,
                            }
                        )
                        break

    holdout_summary: dict[str, object] | None = None
    if selection_summary:
        holdout_path = selection_summary.get("holdout_summary_path")
        if holdout_path:
            holdout_summary = _load_json_file((BASE_DIR / str(holdout_path)).resolve()) or _load_json_file(Path(str(holdout_path)))
        if holdout_summary is None:
            holdout_root = _CHECKPOINTS_DIR / "selection_holdout_tough" / "holdout"
            if not holdout_root.exists():
                holdout_root = _CHECKPOINTS_DIR / "selection_holdout_final" / "holdout"
            for candidate in sorted(holdout_root.rglob("holdout_summary.json")) if holdout_root.exists() else []:
                holdout_summary = _load_json_file(candidate)
                if holdout_summary:
                    break

    selection_history: list[dict[str, object]] = []
    if strict_report:
        final_metrics = strict_report.get("final_eval_metrics") or {}
        selection_history.append(
            {
                "source": "hard_split_selection_balanced_harder_run2",
                "selected_model": strict_report.get("selected_model"),
                "consensus_level": strict_report.get("selected_model"),
                "average_risk": 1.0 - float(final_metrics.get("score", 0.0) or 0.0),
                "timestamp": datetime.now().isoformat(timespec="seconds"),
            }
        )
    elif selection_summary:
        selection_history.append(
            {
                "source": "selection_holdout_final",
                "selected_model": selection_summary.get("selected_model"),
                "selection_metric": selection_summary.get("selection_metric"),
                "selection_value": selection_summary.get("selection_value"),
                "best_alias_path": selection_summary.get("best_alias_path"),
                "ranked_models": selection_summary.get("ranked_models") or [],
                "summary": f"Selected {selection_summary.get('selected_model') or 'unknown'} using {selection_summary.get('selection_metric') or 'selection metric'}",
            }
        )
    if strict_summary:
        runs = strict_summary.get("runs") or []
        for run in runs if isinstance(runs, list) else []:
            if not isinstance(run, dict):
                continue
            selection_history.append(
                {
                    "source": "strict_benchmark",
                    "seed": run.get("seed"),
                    "selected_model": run.get("selected_model"),
                    "final_threshold_mode": strict_summary.get("final_threshold_mode"),
                    "final_eval_metrics": run.get("final_eval_metrics"),
                    "threshold_comparison": run.get("threshold_comparison"),
                    "report_path": run.get("report_path"),
                    "summary": f"Seed {run.get('seed')} selected {run.get('selected_model') or 'unknown'} with F1 {float((run.get('final_eval_metrics') or {}).get('f1', 0)):.3f}",
                }
            )

    threshold_logs: dict[str, object] | None = None
    threshold_source: dict[str, object] | None = None
    if strict_summary:
        runs = strict_summary.get("runs") or []
        first_run = next((run for run in runs if isinstance(run, dict)), None) if isinstance(runs, list) else None
        if first_run and first_run.get("report_path"):
            threshold_source = _load_json_file((BASE_DIR / str(first_run["report_path"])).resolve()) or _load_json_file(Path(str(first_run["report_path"])))
        threshold_logs = {
            "split_dir": strict_summary.get("split_dir"),
            "final_threshold_mode": strict_summary.get("final_threshold_mode"),
            "selected_model": strict_summary.get("selected_model"),
            "aggregate_metrics": strict_summary.get("aggregate_metrics"),
            "runs": strict_summary.get("runs") or [],
            "report": threshold_source or {},
        }

    selection_pipeline = (
        selection_pipeline
        if strict_report
        else {
            "manifest": selection_summary.get("manifest") if selection_summary else None,
            "task": selection_summary.get("task") if selection_summary else None,
            "text_language": selection_summary.get("text_language") if selection_summary else None,
            "selection_metric": selection_summary.get("selection_metric") if selection_summary else None,
            "selected_model": selection_summary.get("selected_model") if selection_summary else None,
            "selection_value": selection_summary.get("selection_value") if selection_summary else None,
            "best_alias_path": selection_summary.get("best_alias_path") if selection_summary else None,
            "ranked_models": selection_summary.get("ranked_models") if selection_summary else [],
            "holdout_metrics": selection_summary.get("holdout_metrics") if selection_summary else None,
        }
    )

    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "benchmarkSource": selection_summary_path.parent.name if selection_summary_path else "unknown",
        "selectionPipeline": selection_pipeline,
        "selectionHistory": selection_history,
        "validationVsHoldout": {
            "cvSummaries": cv_summaries,
            "holdoutSummary": holdout_summary,
        },
        "thresholdLogs": threshold_logs or {},
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
