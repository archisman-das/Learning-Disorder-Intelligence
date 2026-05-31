from __future__ import annotations

import threading
import time
import webbrowser

from dashboard_web import app


def _open_browser() -> None:
    time.sleep(1.5)
    webbrowser.open("http://127.0.0.1:5050")


if __name__ == "__main__":
    threading.Thread(target=_open_browser, daemon=True).start()
    app.run(host="127.0.0.1", port=5050, debug=False)
