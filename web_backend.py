from __future__ import annotations

import json
import os
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
