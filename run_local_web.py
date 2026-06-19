from __future__ import annotations

import os
import json
import socket
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlparse


HOST = "localhost"
PORT = 8080
WEB_ROOT = Path(__file__).resolve().parent / "web"
WHISPER_MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")
_WHISPER_MODEL = None
_WHISPER_MODEL_KEY = None
_FFMPEG_READY = False


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


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


def _transcribe_audio(path: Path, language: str | None) -> str:
    _ensure_ffmpeg_on_path()
    model = _load_whisper_model()
    options: dict[str, object] = {"task": "transcribe", "fp16": False}
    if language:
        options["language"] = language
    result = model.transcribe(str(path), **options)
    return str(result.get("text", "")).strip()


class DashboardRequestHandler(SimpleHTTPRequestHandler):
    def _write_json(self, payload: dict[str, object], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if urlparse(self.path).path == "/api/reading-transcribe":
            self._handle_reading_transcribe()
            return
        self.send_error(404, "Endpoint not found")

    def _handle_reading_transcribe(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length <= 0:
            self._write_json({"error": "No audio payload was received."}, status=400)
            return
        payload = self.rfile.read(content_length)
        if not payload:
            self._write_json({"error": "The uploaded reading sample is empty."}, status=400)
            return

        language_map = {
            "bengali": "bn",
            "english": "en",
            "multilingual": None,
        }
        requested_language = language_map.get((self.headers.get("X-Reading-Language", "") or "").strip().lower())
        suffix = _suffix_from_request(
            self.headers.get("Content-Type", ""),
            self.headers.get("X-Audio-Filename", ""),
        )
        temp_path: Path | None = None
        try:
            with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                temp_file.write(payload)
                temp_path = Path(temp_file.name)
            transcript = _transcribe_audio(temp_path, requested_language)
            self._write_json(
                {
                    "text": transcript,
                    "engine": f"Whisper {WHISPER_MODEL_NAME}",
                    "word_count": len(transcript.split()),
                }
            )
        except ModuleNotFoundError:
            self._write_json(
                {
                    "error": "Whisper is not installed locally. Run `python -m pip install openai-whisper` and restart the dashboard.",
                },
                status=503,
            )
        except Exception as exc:
            self._write_json({"error": f"Whisper transcription failed: {exc}"}, status=500)
        finally:
            if temp_path is not None:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass


def _open_browser() -> None:
    time.sleep(1.0)
    webbrowser.open(f"http://{HOST}:{PORT}")


def _check_port_available() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        if sock.connect_ex((HOST, PORT)) == 0:
            raise OSError(f"Port {PORT} is already in use. Close the existing dashboard first.")


def main() -> None:
    if not WEB_ROOT.exists():
        raise FileNotFoundError(f"Standalone dashboard folder not found: {WEB_ROOT}")

    _check_port_available()
    handler = partial(DashboardRequestHandler, directory=os.fspath(WEB_ROOT))
    server = ReusableThreadingHTTPServer((HOST, PORT), handler)
    print(f"Serving standalone dashboard from {WEB_ROOT}")
    print(f"Open http://{HOST}:{PORT}")
    threading.Thread(target=_open_browser, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
