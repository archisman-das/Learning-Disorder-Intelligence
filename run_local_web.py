from __future__ import annotations

import socket
import threading
import time
import webbrowser
from pathlib import Path

from web_backend import app


BIND_HOST = "0.0.0.0"
DISPLAY_HOST = "127.0.0.1"
PORT = 8080


def _open_browser() -> None:
    time.sleep(1.0)
    webbrowser.open(f"http://{DISPLAY_HOST}:{PORT}")


def _check_port_available() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        if sock.connect_ex((DISPLAY_HOST, PORT)) == 0:
            raise OSError(f"Port {PORT} is already in use. Close the existing dashboard first.")


def main() -> None:
    web_root = Path(__file__).resolve().parent / "web"
    if not web_root.exists():
        raise FileNotFoundError(f"Standalone dashboard folder not found: {web_root}")

    _check_port_available()
    print(f"Serving standalone dashboard from {web_root}")
    print(f"Open http://{DISPLAY_HOST}:{PORT}")
    threading.Thread(target=_open_browser, daemon=True).start()
    app.run(host=BIND_HOST, port=PORT, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
