#!/usr/bin/env python3
"""Preview one widget with sample data — no providers, no host app, no permissions needed.

  python3 tools/dev-widget.py my-widget                 # serve http://127.0.0.1:47950/ (edits reload automatically)
  python3 tools/dev-widget.py my-widget --shot out.png  # render once off-screen and save a screenshot (macOS)
  python3 tools/dev-widget.py my-widget --settings '{"title": "HELLO"}' --mock my-mock.json --width 24vw

Sample data: examples/mock/all.json (every signal, no personal data); --mock overlays your own file.
Before python3 / swift, set DEVELOPER_DIR=/Library/Developer/CommandLineTools if Xcode's license is not accepted.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "host", "dev-server"))
import orbit_config as oc  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="preview one widget with sample data")
    ap.add_argument("id")
    ap.add_argument("--port", type=int, default=47950)
    ap.add_argument("--mock", default=None, help="extra mock JSON {signal: payload} merged over examples/mock/all.json")
    ap.add_argument("--settings", default="{}", help="JSON object of widget settings")
    ap.add_argument("--width", default=None, help="CSS width, e.g. 24vw (default: the manifest's default_size)")
    ap.add_argument("--locale", default="ja-JP")
    ap.add_argument("--shot", default=None, help="save a screenshot here and exit")
    ap.add_argument("--size", default="1710x1112", help="screenshot size")
    a = ap.parse_args()

    errors, warnings = [], []
    plugins = oc.discover_plugins(errors, warnings)
    m = plugins.get(a.id)
    if not m:
        sys.exit("\n".join(errors) or f"unknown widget {a.id!r} (looked in widgets/ and ~/.config/orbit-desktop/widgets)")
    tmp = tempfile.mkdtemp(prefix="orbit-dev-")
    mock = {}
    base = os.path.join(ROOT, "examples", "mock", "all.json")
    if os.path.isfile(base):
        mock.update(json.load(open(base, encoding="utf-8")))
    if a.mock:
        mock.update(json.load(open(a.mock, encoding="utf-8")))
    mock_path = os.path.join(tmp, "mock.json")
    json.dump(mock, open(mock_path, "w", encoding="utf-8"), ensure_ascii=False)
    providers = {p: {"enabled": True} for p in {oc.SIGNAL_PROVIDER[s] for s in m["needs"] if oc.SIGNAL_PROVIDER.get(s)}}
    providers.setdefault("location", {"mode": "fixed", "lat": 51.4779, "lon": -0.0015, "name": "GREENWICH"})
    width = a.width or (m.get("default_size") or {}).get("width") or "auto"
    layout = {"version": 1, "theme": {"locale": a.locale}, "background": {"use": "color", "settings": {"color": "#07080d"}},
              "widgets": [{"use": a.id, "settings": json.loads(a.settings),
                           "position": {"anchor": "center", "x": 0, "y": 0, "width": width, "height": "auto"}}],
              "providers": providers}
    layout_path = os.path.join(tmp, "layout.yaml")
    json.dump(layout, open(layout_path, "w"))              # JSON is valid YAML for the server's parser
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "host", "dev-server", "orbit_server.py"),
                            "--port", str(a.port), "--config", layout_path, "--mock", mock_path, "--no-user-settings"])
    url = f"http://127.0.0.1:{a.port}/?debug"
    try:
        for _ in range(50):
            try:
                cfg = json.load(urllib.request.urlopen(f"http://127.0.0.1:{a.port}/api/config", timeout=1))
                break
            except Exception:
                time.sleep(.2)
        else:
            sys.exit("server did not start")
        for e in cfg["errors"]:
            print("config error:", e)
        if a.shot:
            snap = os.path.join(ROOT, "tools", "snap.swift")
            r = subprocess.run(["swift", snap, url, a.shot, a.size, "8",
                                "JSON.stringify([...document.querySelectorAll('#problems li')].map(l => l.textContent))"],
                               capture_output=True, text=True)
            print(r.stdout.strip() or r.stderr.strip())
            return
        print(f"preview: {url}   (widget.js / style.css / widget.yaml edits reload the page; Ctrl-C to stop)")
        srv.wait()
    except KeyboardInterrupt:
        pass
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
