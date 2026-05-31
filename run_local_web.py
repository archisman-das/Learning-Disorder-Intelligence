from __future__ import annotations

import os
import socket
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "127.0.0.1"
PORT = 8080
WEB_ROOT = Path(__file__).resolve().parent / "web"


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


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
    handler = partial(SimpleHTTPRequestHandler, directory=os.fspath(WEB_ROOT))
    server = ReusableThreadingHTTPServer((HOST, PORT), handler)
    print(f"Serving standalone dashboard from {WEB_ROOT}")
    print(f"Open http://{HOST}:{PORT}")
    threading.Thread(target=_open_browser, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
