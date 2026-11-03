#!/usr/bin/env python3
"""Orbit Desktop - phase 1 dev server (Python stdlib only, 3.9 - 3.13).

Serves the runtime page, builds the sandboxed plugin frames and exposes the
provider API documented in docs/provider-api.md. A future Swift host app will
implement the same API.

Hardening (see docs/security.md):
  * binds 127.0.0.1 only
  * Host header allow-list (blocks DNS-rebinding), Origin check on /api/*
  * no directory listing; only an explicit set of known files is ever served
  * GET only
  * plugin frames get a strict CSP (`default-src 'none'`, no network) plus the
    CSP `sandbox allow-scripts` directive

Usage:
  python3 host/dev-server/orbit_server.py [--port 47900] [--config PATH]

When launched by the Swift host app (host/app) it also gets
  --host-dir DIR     system stats / audio / calendar come from JSON files the app writes there
  --parent-pid PID   exit as soon as the app goes away (never linger holding the port)
"""
from __future__ import annotations

import argparse
import base64
import http.server
import json
import os
import re
import secrets
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import orbit_config as oc  # noqa: E402
from providers import Providers  # noqa: E402

RUNTIME_DIR = os.path.join(oc.REPO_ROOT, "runtime")
RUNTIME_FILES = {  # url path -> (file, content type)
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/runtime/host.js": ("host.js", "text/javascript; charset=utf-8"),
    "/runtime/host.css": ("host.css", "text/css; charset=utf-8"),
    "/runtime/editor.js": ("editor.js", "text/javascript; charset=utf-8"),
    "/runtime/editor.css": ("editor.css", "text/css; charset=utf-8"),
}
SDK_JS = os.path.join(RUNTIME_DIR, "sdk", "orbit-sdk.js")
SDK_CSS = os.path.join(RUNTIME_DIR, "sdk", "orbit-sdk.css")
ASSET_TYPES = {".json": "application/json", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8"}
MAX_SSE_CLIENTS = 8
GENERIC_BY_PATH = {v[0]: (n, v[1]) for n, v in oc.GENERIC_SIGNALS.items()}


class State:
    """Current config + plugins; reloaded when layout.yaml or a manifest changes."""

    def __init__(self, config_path: str, include_user: bool):
        self.config_path = config_path
        self.include_user = include_user
        self.lock = threading.Lock()
        self.stamp = None
        self.version = ""
        self.plugins = {}
        self.resolved = {}
        self.reload_if_changed()

    def _stamp(self):
        parts = []
        for p in [self.config_path, oc.USER_SETTINGS] + [os.path.join(r, n, "widget.yaml") for r in (oc.REPO_WIDGETS, oc.USER_WIDGETS)
                                       if os.path.isdir(r) for n in sorted(os.listdir(r))]:
            try:
                st = os.stat(p)
                parts.append(f"{p}:{st.st_mtime_ns}:{st.st_size}")
            except OSError:
                parts.append(f"{p}:-")
        return "|".join(parts)

    def reload_if_changed(self):
        stamp = self._stamp()
        with self.lock:
            if stamp == self.stamp:
                return
            errors, warnings = [], []
            plugins = oc.discover_plugins(errors, warnings, include_user=self.include_user)
            st = read_user_settings(warnings)
            arr = st.get("arrangement") if isinstance(st.get("arrangement"), dict) else None
            overlay = {k: arr[k] for k in ("zones", "widgets") if arr and k in arr}
            # GUI toggles: data sources on/off, night dim (merged into layout.yaml's values)
            pv = {n: {"enabled": bool(v.get("enabled"))} for n, v in (st.get("providers") or {}).items()
                  if isinstance(v, dict) and "enabled" in v and n in oc.DEFAULT_PROVIDERS} if isinstance(st.get("providers"), dict) else {}
            if pv:
                overlay["providers"] = pv
            th = st.get("theme") if isinstance(st.get("theme"), dict) else {}
            if isinstance(th.get("night_dim"), bool):
                overlay["theme"] = {"night_dim": th["night_dim"]}
            overlay = overlay or None
            res = oc.load_layout(self.config_path, plugins, overlay)
            res["arranged"] = bool(arr)
            res["ackWarnings"] = [a for a in (st.get("acknowledged") or []) if isinstance(a, str)][:200]
            res["catalog"] = catalog(plugins, res["providers"])
            # every module of the layout, before settings.json hides some (for the settings window)
            seen = set()
            res["modules"] = [{"use": w["use"], "name": w["name"]} for w in res["widgets"]
                              if not (w["use"] in seen or seen.add(w["use"]))]
            apply_user_settings(res, warnings)
            res["errors"] = errors + res["errors"]
            res["warnings"] = warnings + res["warnings"]
            self.plugins, self.resolved, self.stamp = plugins, res, stamp
            self.version = format(abs(hash(stamp)) % (1 << 48), "x")
            for e in res["errors"]:
                print(f"[orbit] config error: {e}", flush=True)
            for w in res["warnings"]:
                print(f"[orbit] warning: {w}", flush=True)

    def active_plugin_ids(self):
        # every installed widget may be framed: the layout editor previews widgets before they are added
        ids = {pid for pid, m in self.plugins.items() if m["kind"] == "widget"}
        bg = self.resolved.get("background")
        if bg and not bg["builtin"]:
            ids.add(bg["use"])
        return ids

    def public_config(self):
        r = self.resolved
        prov = r["providers"]
        signals = {n: {"path": f"/api/signals/{v[0]}", "interval": v[2]}
                   for n, v in oc.GENERIC_SIGNALS.items() if v[1] is None or prov[v[1]]["enabled"]}
        return {
            "version": self.version,
            "configPath": self.config_path,
            "theme": r["theme"],
            "background": r["background"],
            "widgets": r["widgets"],
            "zones": r.get("zones", {}),
            "modules": r.get("modules", []),
            "hidden": r.get("hidden", []),
            "layoutOverrides": r.get("layoutOverrides", {}),
            "allWidgets": r.get("allWidgets", r["widgets"]),
            "catalog": r.get("catalog", []),
            "arranged": r.get("arranged", False),
            "pageSeconds": r.get("pageSeconds", 30),
            "ackWarnings": r.get("ackWarnings", []),
            "providerState": {k: v["enabled"] for k, v in prov.items() if isinstance(v, dict) and "enabled" in v},
            "signals": signals,
            "providers": {"weather": prov["weather"]["enabled"], "nowPlaying": prov["now_playing"]["enabled"],
                          "claudeUsage": prov["claude_usage"]["enabled"], "speedtest": prov["speedtest"]["enabled"],
                          "pingTargets": [t["name"] for t in prov["ping"]["targets"]]},
            "errors": r["errors"],
            "warnings": r["warnings"],
        }


MOCK = {"path": None, "mtime": None, "data": None}
MOCK_ALIASES = {"now-playing": "nowPlaying", "claude-usage": "claudeUsage"}


def load_mock():
    """--mock FILE (development only): {"<signal name>": payload, ...} served instead of the real providers."""
    p = MOCK["path"]
    if not p:
        return None
    try:
        m = os.stat(p).st_mtime
        if m != MOCK["mtime"]:
            with open(p, "r", encoding="utf-8") as f:
                MOCK["data"], MOCK["mtime"] = json.load(f), m
    except (OSError, ValueError) as e:
        print(f"[orbit] mock file: {e}", flush=True)
    return MOCK["data"]


LAYOUT_KEYS = {"anchor", "x", "y", "width", "height", "scale"}


def _clean_override(o):
    """Validate one HUD-editor override {anchor, x, y, width, height, scale}; drop anything malformed."""
    out = {}
    if not isinstance(o, dict):
        return out
    for k, v in o.items():
        if k not in LAYOUT_KEYS:
            continue
        if k == "anchor":
            if v in oc.ANCHORS:
                out[k] = v
        elif k == "scale":
            if isinstance(v, (int, float)) and not isinstance(v, bool) and 0.3 <= v <= 4:
                out[k] = round(float(v), 3)
        elif (isinstance(v, (int, float)) and not isinstance(v, bool)) or (isinstance(v, str) and oc.LENGTH_RE.match(v)):
            out[k] = v
    return out


def read_user_settings(warnings):
    try:
        with open(oc.USER_SETTINGS, "r", encoding="utf-8") as f:
            st = json.load(f)
        return st if isinstance(st, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        warnings.append(f"settings.json ignored: {e}")
        return {}


def catalog(plugins, providers):
    """Installed widgets for the layout editor's palette."""
    out = []
    for pid, m in sorted(plugins.items(), key=lambda kv: (kv[1].get("name") or kv[0]).lower()):
        if m["kind"] != "widget":
            continue
        off = sorted({oc.SIGNAL_PROVIDER[s] for s in m["needs"] if oc.SIGNAL_PROVIDER.get(s)
                      and not providers[oc.SIGNAL_PROVIDER[s]]["enabled"]})
        provs = sorted({oc.SIGNAL_PROVIDER[s] for s in m["needs"] if oc.SIGNAL_PROVIDER.get(s)})
        out.append({"id": pid, "name": m.get("name") or pid, "description": m.get("description") or "",
                    "category": m.get("category"), "i18n": m.get("i18n") or {}, "actions": list(m.get("actions") or []),
                    "needs": list(m["needs"]), "assets": list(m.get("assets") or []),
                    "settings": oc.apply_settings(m.get("settings"), None, "", [], []),
                    "schema": m.get("settings") or {}, "providers": provs,
                    "defaultSize": m.get("default_size") or {}, "unofficial": m.get("unofficial", False),
                    "providersOff": off})
    return out


def apply_user_settings(res, warnings):
    """Overlay ~/.config/orbit-desktop/settings.json (written by the host app):
    * wallpaper.hidden: plugin ids to leave out
    * wallpaper.page_seconds: interval of every rotating zone
    * layout: HUD-editor overrides, {"zone:<name>" | "widget:<use>": {anchor, x, y, width, height, scale}}
    The base values from layout.yaml are kept as `base` so the editor can reset an element."""
    for z in res.get("zones", {}).values():
        z.setdefault("scale", 1)
        z["base"] = {k: z.get(k) for k in ("anchor", "x", "y", "width", "height", "scale")}
    for w in res["widgets"]:
        w.setdefault("scale", 1)
        w["base"] = dict(w["position"], scale=w["scale"])
    res["hidden"], res["layoutOverrides"] = [], {}
    rz = [z["rotate_seconds"] for z in res.get("zones", {}).values() if z.get("rotate_seconds")]
    res["pageSeconds"] = rz[0] if rz else 30
    try:
        with open(oc.USER_SETTINGS, "r", encoding="utf-8") as f:
            st = json.load(f)
    except FileNotFoundError:
        return
    except (OSError, ValueError) as e:
        warnings.append(f"settings.json ignored: {e}")
        return
    if not isinstance(st, dict):
        return
    # legacy position overrides (first editor version); a GUI arrangement supersedes them
    lo = st.get("layout") if isinstance(st.get("layout"), dict) and not res.get("arranged") else {}
    for key, o in lo.items():
        o = _clean_override(o)
        if not o or not isinstance(key, str):
            continue
        kind, _, name = key.partition(":")
        if kind == "zone" and name in res.get("zones", {}):
            res["zones"][name].update(o)
            res["layoutOverrides"][key] = o
        elif kind == "widget":
            hit = False
            for w in res["widgets"]:
                if w["use"] == name and not w.get("zone"):
                    if "scale" in o:
                        w["scale"] = o["scale"]
                    w["position"].update({k: v for k, v in o.items() if k != "scale"})
                    hit = True
            if hit:
                res["layoutOverrides"][key] = o
    res["allWidgets"] = list(res["widgets"])     # before hiding: the editor keeps hidden widgets in the arrangement
    wp = st.get("wallpaper")
    if not isinstance(wp, dict):
        return
    hidden = {h for h in (wp.get("hidden") or []) if isinstance(h, str)}
    if hidden:
        res["hidden"] = sorted(hidden)
        res["widgets"] = [w for w in res["widgets"] if w["use"] not in hidden]
    ps = wp.get("page_seconds")
    if isinstance(ps, (int, float)) and not isinstance(ps, bool) and 5 <= ps <= 3600:
        res["pageSeconds"] = int(ps)
    if isinstance(ps, (int, float)) and not isinstance(ps, bool) and 5 <= ps <= 3600:
        for z in res.get("zones", {}).values():
            if z.get("rotate_seconds"):
                z["rotate_seconds"] = int(ps)


def read_text(path, limit=2_000_000):
    with open(path, "r", encoding="utf-8") as f:
        return f.read(limit)


def make_handler(state: State, prov: Providers, port: int):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    allowed_origins = {f"http://{h}" for h in allowed_hosts}
    ancestors = " ".join(sorted(allowed_origins))
    sse_slots = threading.BoundedSemaphore(MAX_SSE_CLIENTS)

    host_csp = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                "media-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; "
                "object-src 'none'; frame-ancestors 'none'")

    class Handler(http.server.BaseHTTPRequestHandler):
        def version_string(self):
            return "OrbitDesktopDev"

        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        # ---------------------------------------------------------- method gate
        def do_HEAD(self):
            self.send_error(405)

        def do_POST(self):
            self.send_error(405)

        do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_POST

        def do_GET(self):
            if self.headers.get("Host", "") not in allowed_hosts:
                return self.send_error(403, "Host not allowed")
            path = self.path.split("?", 1)[0]
            if path.startswith("/api/"):
                origin = self.headers.get("Origin")
                if origin is not None and origin not in allowed_origins:
                    return self.send_error(403, "Origin not allowed")
                return self.api(path)
            if path in RUNTIME_FILES:
                name, ctype = RUNTIME_FILES[path]
                try:
                    with open(os.path.join(RUNTIME_DIR, name), "rb") as f:
                        body = f.read()
                except OSError:
                    return self.send_error(404)
                extra = {"Content-Security-Policy": host_csp} if ctype.startswith("text/html") else {}
                return self.send(body, ctype, extra)
            m = re.match(r"^/frame/([a-z0-9][a-z0-9-]{1,40})$", path)
            if m:
                return self.frame(m.group(1))
            m = re.match(r"^/plugins/([a-z0-9][a-z0-9-]{1,40})/assets/([A-Za-z0-9._/-]+)$", path)
            if m:
                return self.plugin_asset(m.group(1), m.group(2))
            if path == "/media/background":
                return self.media()
            self.send_error(404)

        # ---------------------------------------------------------- helpers
        def send(self, body: bytes, ctype: str, extra: dict | None = None, status=200):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def json(self, obj):
            return self.send(json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

        # ---------------------------------------------------------- API
        def api(self, path):
            state.reload_if_changed()
            mock = load_mock()
            if mock is not None and path.startswith("/api/signals/"):
                key = path[len("/api/signals/"):]
                name = GENERIC_BY_PATH.get(key, (MOCK_ALIASES.get(key, key),))[0]
                if name in mock:
                    return self.json(mock[name])
            if path == "/api/health":
                return self.json({"ok": True, "api": 1, "server": "orbit-dev-server", "time": time.time(),
                              "hostApp": prov.host_dir is not None})
            if path == "/api/config":
                return self.json(state.public_config())
            if path == "/api/editor-draft":       # the layout editor's unsaved draft (written by the host app)
                body = None
                if prov.host_dir:
                    try:
                        with open(os.path.join(prov.host_dir, "editor-draft.json"), "rb") as f:
                            body = f.read(2_000_000)
                    except OSError:
                        pass
                return self.send(body or b"null", "application/json; charset=utf-8")
            if path == "/api/config/version":
                return self.json({"version": state.version})
            if path == "/api/signals/system":
                return self.json(prov.get("system"))
            if path == "/api/signals/now-playing":
                if not state.resolved["providers"]["now_playing"]["enabled"]:
                    return self.send_error(404, "now_playing provider disabled")
                return self.json(prov.get("nowPlaying"))
            if path == "/api/signals/artwork":
                body, ctype = prov.artwork()
                if not body:
                    return self.send_error(404)
                return self.send(body, ctype)
            if path == "/api/signals/calendar":
                return self.send(prov.calendar_bytes(), "application/json; charset=utf-8")
            if path == "/api/signals/weather":
                if not state.resolved["providers"]["weather"]["enabled"]:
                    return self.send_error(404, "weather provider disabled")
                return self.json(prov.get("weather"))
            if path == "/api/signals/location":
                return self.json(prov.get("location"))
            if path == "/api/signals/claude-usage":
                if not state.resolved["providers"]["claude_usage"]["enabled"]:
                    return self.send_error(404, "claude_usage provider disabled (unofficial, opt-in)")
                return self.json(prov.get("claudeUsage"))
            if path == "/api/signals/audio":
                try:
                    with open(prov.audio_path(), "rb") as f:
                        body = f.read(4096)
                except OSError:
                    body = b"null"
                return self.send(body, "application/json")
            if path == "/api/stream/audio":
                return self.audio_stream()
            m = re.match(r"^/api/signals/([a-z][a-z0-9-]{1,30})$", path)
            if m and m.group(1) in GENERIC_BY_PATH:
                name, prov_key = GENERIC_BY_PATH[m.group(1)]
                if prov_key and not state.resolved["providers"][prov_key]["enabled"]:
                    return self.send_error(404, f"{prov_key} provider disabled")
                return self.json(prov.get(name))
            self.send_error(404)

        def audio_stream(self):
            """Server-Sent Events: push each new frame the audio helper writes (~20 Hz)."""
            if not sse_slots.acquire(blocking=False):
                return self.send_error(503, "too many streams")
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.close_connection = True
                fp, last, beat = prov.audio_path(), 0, time.time()
                while True:
                    try:
                        m = os.stat(fp).st_mtime_ns
                        if m != last:
                            last = m
                            with open(fp, "rb") as f:
                                data = f.read(4096).strip().replace(b"\n", b"")
                            if data:
                                self.wfile.write(b"data: " + data + b"\n\n")
                                self.wfile.flush()
                    except OSError:
                        pass
                    if time.time() - beat > 15:  # keep-alive comment; detects closed clients
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        beat = time.time()
                    time.sleep(0.015)
            except (BrokenPipeError, ConnectionResetError, OSError):
                return
            finally:
                sse_slots.release()

        # ---------------------------------------------------------- plugin frames
        def frame(self, pid):
            state.reload_if_changed()
            if pid not in state.active_plugin_ids() or pid not in state.plugins:
                return self.send_error(404)
            m = state.plugins[pid]
            try:
                sdk_js, sdk_css = read_text(SDK_JS), read_text(SDK_CSS)
                js = read_text(os.path.join(m["folder"], "widget.js"))
                css_path = os.path.join(m["folder"], "style.css")
                css = read_text(css_path) if os.path.isfile(css_path) else ""
            except OSError:
                return self.send_error(500)
            nonce = base64.b64encode(secrets.token_bytes(16)).decode()

            def safe_js(s):  # keep the inline script from closing its own tag
                return s.replace("</script", "<\\/script").replace("<!--", "<\\!--")

            def safe_css(s):
                return s.replace("</style", "<\\/style")

            meta = json.dumps({"id": pid, "kind": m["kind"]})
            html = (
                "<!doctype html><html><head><meta charset=\"utf-8\">"
                f"<title>{pid}</title><style>{safe_css(sdk_css)}</style><style>{safe_css(css)}</style></head>"
                f"<body class=\"orbit-{m['kind']}\"><div id=\"orbit-root\"></div>"
                f"<script nonce=\"{nonce}\">window.__ORBIT_PLUGIN__={meta};</script>"
                f"<script nonce=\"{nonce}\">{safe_js(sdk_js)}</script>"
                f"<script nonce=\"{nonce}\">{safe_js(js)}\n//# sourceURL=orbit-plugin/{pid}/widget.js</script>"
                "</body></html>"
            ).encode("utf-8")
            csp = (f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; img-src data: blob:; "
                   "font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; child-src 'none'; "
                   "worker-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; "
                   f"frame-ancestors {ancestors}; sandbox allow-scripts")
            return self.send(html, "text/html; charset=utf-8", {
                "Content-Security-Policy": csp,
                "Permissions-Policy": "camera=(), microphone=(), geolocation=(), usb=(), payment=(), display-capture=()",
            })

        def plugin_asset(self, pid, rel):
            if pid not in state.active_plugin_ids() or pid not in state.plugins:
                return self.send_error(404)
            m = state.plugins[pid]
            if rel not in m.get("assets", []):  # only files the manifest lists (already path-checked)
                return self.send_error(404)
            ext = os.path.splitext(rel)[1].lower()
            try:
                with open(os.path.join(m["folder"], rel), "rb") as f:
                    body = f.read(oc.MAX_ASSET + 1)
            except OSError:
                return self.send_error(404)
            return self.send(body, ASSET_TYPES.get(ext, "application/octet-stream"))

        # ---------------------------------------------------------- built-in image / video background
        def media(self):
            state.reload_if_changed()
            mp = oc.media_path_for(state.resolved.get("background"))
            if not mp:
                return self.send_error(404)
            path, ctype = mp
            size = os.path.getsize(path)
            rng = self.headers.get("Range", "")
            m = re.match(r"^bytes=(\d*)-(\d*)$", rng.strip())
            start, end, status = 0, size - 1, 200
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    end = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
                else:
                    start = max(0, size - int(m.group(2)))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206
            length = end - start + 1
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            try:
                with open(path, "rb") as f:
                    f.seek(start)
                    left = length
                    while left > 0:
                        chunk = f.read(min(1 << 20, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    return Handler


def watch_parent(pid: int):
    while True:
        time.sleep(2)
        if os.getppid() != pid:  # re-parented to launchd: the host app died
            print("[orbit] host app went away; exiting", flush=True)
            os._exit(0)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Orbit Desktop dev server (127.0.0.1 only)")
    ap.add_argument("--port", type=int, default=47900)
    ap.add_argument("--config", default=None,
                    help=f"layout.yaml (default: {oc.USER_CONFIG}, falling back to examples/layout.yaml)")
    ap.add_argument("--no-user-plugins", action="store_true", help=f"ignore {oc.USER_WIDGETS}")
    ap.add_argument("--host-dir", default=None, help="read native host-app provider files from DIR")
    ap.add_argument("--parent-pid", type=int, default=None, help="exit when this process is gone")
    ap.add_argument("--mock", default=None, help="development: JSON file {signal: payload} served instead of providers")
    a = ap.parse_args(argv)
    cfg = a.config or (oc.USER_CONFIG if os.path.isfile(oc.USER_CONFIG) else oc.EXAMPLE_CONFIG)
    cfg = os.path.abspath(os.path.expanduser(cfg))
    state = State(cfg, include_user=not a.no_user_plugins)
    MOCK["path"] = os.path.abspath(a.mock) if a.mock else None
    host_dir = os.path.abspath(os.path.expanduser(a.host_dir)) if a.host_dir else None
    prov = Providers(state.resolved["providers"], host_dir=host_dir)
    prov.start()
    if a.parent_pid:
        threading.Thread(target=watch_parent, args=(a.parent_pid,), daemon=True, name="watch_parent").start()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(state, prov, a.port))
    srv.daemon_threads = True
    print(f"[orbit] config: {cfg}", flush=True)
    print(f"[orbit] serving http://127.0.0.1:{a.port}/  (providers are read at start-up; restart after changing providers:)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
