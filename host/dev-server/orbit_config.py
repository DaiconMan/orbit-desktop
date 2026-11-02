"""Manifest + layout validation shared by the dev server and tools/validate.py.

Everything here is pure stdlib and side-effect free (it only reads files), so
it can run in CI. Errors are collected (not raised) so the runtime can show a
friendly list on the desktop instead of a blank screen.
"""
from __future__ import annotations

import copy
import ipaddress
import os
import re

import miniyaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REPO_WIDGETS = os.path.join(REPO_ROOT, "widgets")
USER_DIR = os.path.expanduser("~/.config/orbit-desktop")
USER_CONFIG = os.path.join(USER_DIR, "layout.yaml")
USER_WIDGETS = os.path.join(USER_DIR, "widgets")
# Written by the host app's settings window: {"wallpaper": {"hidden": [use ids], "page_seconds": n}, "eew": {...}}
USER_SETTINGS = os.path.join(USER_DIR, "settings.json")
EXAMPLE_CONFIG = os.path.join(REPO_ROOT, "examples", "layout.yaml")
CACHE_DIR = os.path.expanduser("~/Library/Caches/orbit-desktop")

# Data signals a plugin may request in `needs:`. Anything else is rejected.
SIGNALS = {
    "time": "Clock tick (1 Hz) with locale / time zone",
    "system": "CPU, memory, disk I/O, network throughput, ping targets, speed test",
    "audio": "System-audio spectrum (level, bass, mid, high, 16 bands), ~20 Hz",
    "nowPlaying": "Current track from Apple Music / Spotify incl. artwork (data: URL)",
    "calendar": "Today's and tomorrow's calendar events (title, time, colour, calendar name)",
    "weather": "Open-Meteo forecast for the configured location + place name",
    "location": "Latitude / longitude / place name",
    "claudeUsage": "UNOFFICIAL: Claude Code usage meters from ~/.claude.json (opt-in)",
    "mac": "Battery, Time Machine, free disk space, active (input) minutes today",
    "network": "Home/away, Tailscale, NAS mounts, ping targets, line speed",
    "alerts": "Earthquake Early Warning and tsunami warnings (host app, JP)",
    "iss": "ISS position (lat/lon/altitude), opt-in network",
    "quakes": "Recent earthquakes (JMA via P2PQuake, JP), opt-in network",
    "holidays": "Upcoming public holidays, opt-in network",
    "fx": "Exchange rate with previous value, opt-in network",
    "news": "News headlines from an RSS feed, opt-in network",
    "bluetooth": "Connected Bluetooth devices with battery levels",
    "onthisday": "On this day: events and observances (Wikipedia), opt-in network",
    "launches": "Upcoming rocket launches (The Space Devs), opt-in network",
    "kp": "Planetary Kp index (NOAA SWPC), opt-in network",
    "recent": "Recently played tracks (local history of nowPlaying)",
    "contrib": "GitHub contribution calendar (via gh), opt-in",
    "github": "GitHub review requests and my PRs with CI state (via gh), opt-in",
    "sessions": "Local Claude Code sessions (cwd basenames), opt-in",
    "rfc": "Documents awaiting approval in a GitHub repo (via gh), opt-in, personal",
}
SENSITIVE_SIGNALS = {"calendar", "location", "nowPlaying", "claudeUsage", "network", "github", "sessions", "rfc",
                     "recent", "bluetooth", "contrib"}

# Signals the server serves generically at /api/signals/<path> from Providers.get(<name>).
# name -> (path, providers.<key> that must be enabled (None: always), runtime poll interval in ms)
GENERIC_SIGNALS = {
    "mac": ("mac", "mac", 30000),
    "network": ("network", "network", 5000),
    "alerts": ("alerts", None, 1000),
    "iss": ("iss", "iss", 10000),
    "quakes": ("quakes", "quakes", 60000),
    "holidays": ("holidays", "holidays", 3600000),
    "fx": ("fx", "fx", 1800000),
    "news": ("news", "news", 600000),
    "bluetooth": ("bluetooth", "bluetooth", 120000),
    "onthisday": ("onthisday", "onthisday", 600000),
    "launches": ("launches", "launches", 1800000),
    "kp": ("kp", "kp", 1800000),
    "recent": ("recent", "recent", 10000),
    "contrib": ("contrib", "contrib", 1800000),
    "github": ("github", "github", 300000),
    "sessions": ("sessions", "sessions", 15000),
    "rfc": ("rfc", "rfc", 600000),
}

SETTING_TYPES = {"string", "number", "integer", "boolean", "color", "enum", "length", "list"}
KINDS = {"widget", "background"}
ANCHORS = {"top-left", "top-center", "top-right", "center-left", "center", "center-right",
           "bottom-left", "bottom-center", "bottom-right"}

# Reaction sources the runtime computes for backgrounds (all normalised 0..1).
REACT_SOURCES = {"cpu", "net", "audio.level", "audio.bass", "audio.mid", "audio.high"}

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$")
LENGTH_RE = re.compile(r"^-?\d+(\.\d+)?(px|vh|vw|vmin|vmax|%|rem|em)?$")
COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|[a-zA-Z]{3,20})$")
FONT_RE = re.compile(r"^[A-Za-z0-9 ,.'\"\-_　-鿿＀-￯]{1,300}$")
LOCALE_RE = re.compile(r"^(auto|[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*)$")
HOST_RE = re.compile(r"^[A-Za-z0-9.\-:\[\]]{1,253}$")

ALLOWED_PLUGIN_FILES = {"widget.yaml", "widget.js", "style.css", "README.md", "LICENSE"}
MAX_PLUGIN_JS = 512 * 1024
MAX_ASSET = 4 * 1024 * 1024

IMAGE_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
             ".gif": "image/gif", ".heic": "image/heic"}
VIDEO_EXT = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}


# --------------------------------------------------------------------------- settings schema
def _check_value(spec: dict, value, where: str, errors: list):
    t = spec.get("type")
    ok = True
    if t == "string":
        ok = isinstance(value, str) and len(value) <= 2000
    elif t == "number":
        ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    elif t == "integer":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif t == "boolean":
        ok = isinstance(value, bool)
    elif t == "color":
        ok = isinstance(value, str) and bool(COLOR_RE.match(value))
        if not ok:
            errors.append(f"{where}: expected a colour like \"#46dcc8\" (quote it - a bare # starts a YAML comment), got {value!r}")
            return False
    elif t == "length":
        ok = (isinstance(value, (int, float)) and not isinstance(value, bool)) or (isinstance(value, str) and bool(LENGTH_RE.match(value)))
    elif t == "enum":
        ok = value in (spec.get("options") or [])
        if not ok:
            errors.append(f"{where}: must be one of {spec.get('options')}, got {value!r}")
            return False
    elif t == "list":
        ok = isinstance(value, list) and len(value) <= 100
        item = spec.get("items")
        if ok and isinstance(item, dict):
            for i, v in enumerate(value):
                if not _check_value(item, v, f"{where}[{i}]", errors):
                    return False
    if not ok:
        errors.append(f"{where}: expected {t}, got {value!r}")
        return False
    if t in ("number", "integer"):
        if "min" in spec and value < spec["min"]:
            errors.append(f"{where}: must be >= {spec['min']}, got {value}")
            return False
        if "max" in spec and value > spec["max"]:
            errors.append(f"{where}: must be <= {spec['max']}, got {value}")
            return False
    return True


def validate_settings_schema(schema, where: str, errors: list):
    if schema is None:
        return {}
    if not isinstance(schema, dict):
        errors.append(f"{where}: must be a mapping of setting name -> spec")
        return {}
    for name, spec in schema.items():
        w = f"{where}.{name}"
        if not re.match(r"^[a-z][a-z0-9_]{0,40}$", name):
            errors.append(f"{w}: setting names must be snake_case")
            continue
        if not isinstance(spec, dict):
            errors.append(f"{w}: must be a mapping with at least 'type' and 'default'")
            continue
        t = spec.get("type")
        if t not in SETTING_TYPES:
            errors.append(f"{w}.type: must be one of {sorted(SETTING_TYPES)}, got {t!r}")
            continue
        if t == "enum" and not (isinstance(spec.get("options"), list) and spec["options"]):
            errors.append(f"{w}.options: enum settings need a non-empty options list")
            continue
        if "default" not in spec:
            errors.append(f"{w}: missing 'default'")
            continue
        unknown = set(spec) - {"type", "default", "description", "min", "max", "options", "items"}
        if unknown:
            errors.append(f"{w}: unknown keys {sorted(unknown)}")
        if spec["default"] is not None:
            _check_value(spec, spec["default"], f"{w}.default", errors)
    return schema


def apply_settings(schema: dict, given, where: str, errors: list, warnings: list) -> dict:
    """Merge user settings over schema defaults, type-checking each value."""
    out = {k: copy.deepcopy(v.get("default")) for k, v in (schema or {}).items() if isinstance(v, dict)}
    if given is None:
        return out
    if not isinstance(given, dict):
        errors.append(f"{where}: must be a mapping")
        return out
    for k, v in given.items():
        if k not in (schema or {}):
            known = ", ".join(sorted(schema or {})) or "(none)"
            errors.append(f"{where}.{k}: unknown setting (known: {known})")
            continue
        if _check_value(schema[k], v, f"{where}.{k}", errors):
            out[k] = v
    return out


# --------------------------------------------------------------------------- built-in backgrounds
BUILTIN_BACKGROUNDS = {
    "color": {
        "id": "color", "name": "Solid colour", "kind": "background", "builtin": True, "needs": [],
        "settings": {"color": {"type": "color", "default": "#05060a", "description": "Fill colour"}},
    },
    "gradient": {
        "id": "gradient", "name": "Gradient", "kind": "background", "builtin": True, "needs": [],
        "settings": {
            "stops": {"type": "list", "items": {"type": "color", "default": "#000"}, "default": ["#05060a", "#14203a"], "description": "2+ colours"},
            "angle": {"type": "number", "default": 180, "min": 0, "max": 360, "description": "Linear gradient angle (deg)"},
            "style": {"type": "enum", "options": ["linear", "radial"], "default": "linear"},
        },
    },
    "image": {
        "id": "image", "name": "Image", "kind": "background", "builtin": True, "needs": [],
        "settings": {
            "path": {"type": "string", "default": None, "description": "Absolute or ~ path to a local image"},
            "fit": {"type": "enum", "options": ["cover", "contain", "fill"], "default": "cover"},
            "opacity": {"type": "number", "default": 1, "min": 0, "max": 1},
            "blur": {"type": "number", "default": 0, "min": 0, "max": 200, "description": "Blur radius (px)"},
            "color": {"type": "color", "default": "#000000", "description": "Colour behind the image"},
        },
    },
    "video": {
        "id": "video", "name": "Video", "kind": "background", "builtin": True, "needs": [],
        "settings": {
            "path": {"type": "string", "default": None, "description": "Absolute or ~ path to a local .mp4/.mov/.m4v/.webm"},
            "fit": {"type": "enum", "options": ["cover", "contain", "fill"], "default": "cover"},
            "opacity": {"type": "number", "default": 1, "min": 0, "max": 1},
            "playback_rate": {"type": "number", "default": 1, "min": 0.1, "max": 4},
            "color": {"type": "color", "default": "#000000"},
        },
    },
}


def media_path_for(bg: dict):
    """Return (abs_path, mime) of the local file a built-in image/video background uses, else None."""
    if not bg or bg.get("use") not in ("image", "video"):
        return None
    p = (bg.get("settings") or {}).get("path")
    if not isinstance(p, str) or not p:
        return None
    p = os.path.realpath(os.path.expanduser(p))
    ext = os.path.splitext(p)[1].lower()
    table = IMAGE_EXT if bg["use"] == "image" else VIDEO_EXT
    if ext not in table or not os.path.isfile(p):
        return None
    return p, table[ext]


# --------------------------------------------------------------------------- manifests
def load_manifest(folder: str, errors: list) -> dict | None:
    """Load and validate one plugin folder. Appends human-readable errors."""
    pid = os.path.basename(os.path.normpath(folder))
    where = f"widgets/{pid}/widget.yaml"
    path = os.path.join(folder, "widget.yaml")
    try:
        m = miniyaml.load_file(path)
    except FileNotFoundError:
        errors.append(f"{where}: missing")
        return None
    except (miniyaml.YamlError, UnicodeDecodeError) as e:
        errors.append(f"{where}: {e}")
        return None
    if not isinstance(m, dict):
        errors.append(f"{where}: must be a mapping")
        return None
    n0 = len(errors)
    allowed = {"id", "name", "version", "author", "license", "kind", "description", "needs", "settings",
               "default_size", "assets", "reactions", "unofficial", "homepage", "min_runtime"}
    for k in sorted(set(m) - allowed):
        errors.append(f"{where}: unknown key {k!r}")
    for req in ("id", "name", "version", "author", "license", "kind"):
        if m.get(req) in (None, ""):
            errors.append(f"{where}: missing required key {req!r}")
    if isinstance(m.get("version"), (int, float)) and not isinstance(m.get("version"), bool):
        m["version"] = str(m["version"])
    if m.get("id") is not None and (not isinstance(m["id"], str) or not ID_RE.match(m["id"])):
        errors.append(f"{where}: id must match {ID_RE.pattern}")
    elif m.get("id") and m["id"] != pid:
        errors.append(f"{where}: id {m['id']!r} must equal the folder name {pid!r}")
    if m.get("id") in BUILTIN_BACKGROUNDS:
        errors.append(f"{where}: id {m['id']!r} is reserved for a built-in background")
    if m.get("version") and not SEMVER_RE.match(str(m["version"])):
        errors.append(f"{where}: version must be semver like \"1.0.0\"")
    if m.get("kind") is not None and m.get("kind") not in KINDS:
        errors.append(f"{where}: kind must be one of {sorted(KINDS)}")
    needs = m.get("needs") or []
    if not isinstance(needs, list) or any(not isinstance(x, str) for x in needs):
        errors.append(f"{where}: needs must be a list of signal names")
        needs = []
    for s in needs:
        if s not in SIGNALS:
            errors.append(f"{where}: unknown signal {s!r} in needs (known: {', '.join(sorted(SIGNALS))})")
    if len(set(needs)) != len(needs):
        errors.append(f"{where}: duplicate entries in needs")
    m["needs"] = needs
    m["settings"] = validate_settings_schema(m.get("settings"), f"{where}: settings", errors)
    m["unofficial"] = bool(m.get("unofficial", False))

    ds = m.get("default_size") or {}
    if not isinstance(ds, dict) or set(ds) - {"width", "height"}:
        errors.append(f"{where}: default_size must be a mapping with width/height")
        ds = {}
    for k, v in ds.items():
        if v != "auto" and not (isinstance(v, (int, float)) or (isinstance(v, str) and LENGTH_RE.match(v))):
            errors.append(f"{where}: default_size.{k} must be a CSS length or 'auto'")
    m["default_size"] = ds

    # files
    if not os.path.isfile(os.path.join(folder, "widget.js")):
        errors.append(f"widgets/{pid}: widget.js is missing")
    elif os.path.getsize(os.path.join(folder, "widget.js")) > MAX_PLUGIN_JS:
        errors.append(f"widgets/{pid}: widget.js is larger than {MAX_PLUGIN_JS // 1024} KB")
    if not os.path.isfile(os.path.join(folder, "README.md")):
        errors.append(f"widgets/{pid}: README.md is missing")

    assets = m.get("assets") or []
    clean_assets = []
    if not isinstance(assets, list):
        errors.append(f"{where}: assets must be a list of relative paths")
        assets = []
    real_folder = os.path.realpath(folder)
    for a in assets:
        if not isinstance(a, str) or a.startswith("/") or ".." in a.split("/") or not re.match(r"^[A-Za-z0-9._/-]+$", a):
            errors.append(f"{where}: bad asset path {a!r}")
            continue
        full = os.path.realpath(os.path.join(folder, a))
        if not full.startswith(real_folder + os.sep) or not os.path.isfile(full):
            errors.append(f"{where}: asset {a!r} not found inside the plugin folder")
            continue
        if os.path.splitext(a)[1].lower() not in (".json", ".txt", ".csv"):
            errors.append(f"{where}: asset {a!r}: only .json/.txt/.csv data assets are supported in phase 1")
            continue
        if os.path.getsize(full) > MAX_ASSET:
            errors.append(f"{where}: asset {a!r} is larger than {MAX_ASSET // (1024 * 1024)} MB")
            continue
        clean_assets.append(a)
    m["assets"] = clean_assets

    r = m.get("reactions")
    if r is not None:
        if m.get("kind") != "background":
            errors.append(f"{where}: reactions are only valid for kind: background")
        elif not isinstance(r, dict) or not isinstance(r.get("hooks"), dict):
            errors.append(f"{where}: reactions needs a 'hooks' mapping (hook -> description)")
        else:
            m["reactions"]["default"] = _validate_react(r.get("default") or {}, r["hooks"], f"{where}: reactions.default", errors)
    if len(errors) > n0:
        return None
    m["folder"] = folder
    return m


def _validate_react(react, hooks: dict, where: str, errors: list) -> dict:
    out = {}
    if not isinstance(react, dict):
        errors.append(f"{where}: must be a mapping of source -> hook (or list of hooks)")
        return out
    for src, h in react.items():
        if src not in REACT_SOURCES:
            errors.append(f"{where}.{src}: unknown source (known: {', '.join(sorted(REACT_SOURCES))})")
            continue
        hs = h if isinstance(h, list) else [h]
        good = []
        for x in hs:
            if x not in hooks:
                errors.append(f"{where}.{src}: unknown hook {x!r} (this background supports: {', '.join(sorted(hooks))})")
            else:
                good.append(x)
        out[src] = good
    return out


def discover_plugins(errors: list, warnings: list, include_user: bool = True) -> dict:
    """Scan repo widgets/ and ~/.config/orbit-desktop/widgets/. Returns id -> manifest."""
    plugins = {}
    roots = [(REPO_WIDGETS, "bundled")]
    if include_user:
        roots.append((USER_WIDGETS, "user"))
    for root, origin in roots:
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            folder = os.path.join(root, name)
            if name.startswith(".") or not os.path.isdir(folder):
                continue
            m = load_manifest(folder, errors)
            if not m:
                continue
            if m["id"] in plugins:
                warnings.append(f"plugin {m['id']!r} from {origin} folder ignored: id already provided by the bundled set")
                continue
            m["origin"] = origin
            plugins[m["id"]] = m
    return plugins


# --------------------------------------------------------------------------- layout config
DEFAULT_THEME = {
    "font": "-apple-system, \"SF Pro Display\", \"Hiragino Sans\", sans-serif",
    "mono_font": "ui-monospace, \"SF Mono\", Menlo, monospace",
    "accent": "auto",
    "text_color": "#ffffff",
    "locale": "auto",
    "hour12": False,
    "night_dim": False,      # 00:00-06:00: widgets settle to ~65 % opacity
}

DEFAULT_PROVIDERS = {
    "location": {"mode": "fixed", "lat": 51.4779, "lon": -0.0015, "name": "GREENWICH",
                 "corelocation_cli": "/opt/homebrew/bin/CoreLocationCLI"},
    "weather": {"enabled": True, "refresh_minutes": 15, "air": True, "pressure": True},
    "system": {"interface": "auto"},
    "ping": {"targets": [], "interval_seconds": 10, "external_file": None},
    "speedtest": {"enabled": False, "interval_minutes": 60, "only_on_ac_power": True},
    "now_playing": {"enabled": True, "players": ["music", "spotify"], "itunes_artwork_fallback": False,
                    "itunes_country": "US"},
    "calendar": {"file": os.path.join(CACHE_DIR, "calendar.json")},
    "audio": {"file": os.path.join(CACHE_DIR, "audiopulse.json")},
    "claude_usage": {"enabled": False},
    "mac": {"enabled": True, "active": True},
    "network": {"enabled": True, "home_subnet": None, "home_ssid": None, "home_interface": "auto", "mounts": [],
                "interval_seconds": 5},
    "iss": {"enabled": False},
    "quakes": {"enabled": False, "min_intensity": "3", "hours": 24},
    "holidays": {"enabled": False, "country": "JP"},
    "fx": {"enabled": False, "base": "USD", "quote": "JPY"},
    "news": {"enabled": False, "url": "https://www.nhk.or.jp/rss/news/cat0.xml", "max_items": 8},
    "bluetooth": {"enabled": False},
    "onthisday": {"enabled": False, "lang": "ja"},
    "launches": {"enabled": False},
    "kp": {"enabled": False},
    "recent": {"enabled": True, "max_items": 8},
    "contrib": {"enabled": False},
    "github": {"enabled": False, "gh_path": "gh"},
    "sessions": {"enabled": False},
    "rfc": {"enabled": False, "repo": None, "dir": "rfc", "file_prefix": "RFC-", "status_label": "Status",
            "pending_text": "Pending approval", "user_action_text": None},
}

# JMA seismic intensity labels accepted by providers.quakes.min_intensity (quote them: "5弱").
QUAKE_SCALES = ("1", "2", "3", "4", "5弱", "5強", "6弱", "6強", "7")
GITHUB_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
REPO_DIR_RE = re.compile(r"^[A-Za-z0-9_.\-/]{1,200}$")
CURRENCY_RE = re.compile(r"^[A-Za-z]{3}$")

PROVIDER_SCHEMA = {
    "location": {"mode": ("enum", ["fixed", "corelocation", "ip"]), "lat": ("number", (-90, 90)),
                 "lon": ("number", (-180, 180)), "name": ("string", None), "corelocation_cli": ("string", None)},
    "weather": {"enabled": ("boolean", None), "refresh_minutes": ("integer", (5, 1440)), "air": ("boolean", None),
                "pressure": ("boolean", None)},
    "system": {"interface": ("string", None)},
    "ping": {"targets": ("list", None), "interval_seconds": ("integer", (2, 3600)), "external_file": ("string?", None)},
    "speedtest": {"enabled": ("boolean", None), "interval_minutes": ("integer", (15, 1440)), "only_on_ac_power": ("boolean", None)},
    "now_playing": {"enabled": ("boolean", None), "players": ("list", None), "itunes_artwork_fallback": ("boolean", None),
                    "itunes_country": ("string", None)},
    "calendar": {"file": ("string", None)},
    "audio": {"file": ("string", None)},
    "claude_usage": {"enabled": ("boolean", None)},
    "mac": {"enabled": ("boolean", None), "active": ("boolean", None)},
    "network": {"enabled": ("boolean", None), "home_subnet": ("string?", None), "home_ssid": ("string?", None),
                "home_interface": ("string", None), "mounts": ("list", None), "interval_seconds": ("integer", (2, 600))},
    "quakes": {"enabled": ("boolean", None), "min_intensity": ("enum", list(QUAKE_SCALES) + [1, 2, 3, 4, 7]), "hours": ("integer", (1, 168))},
    "holidays": {"enabled": ("boolean", None), "country": ("enum", ["JP"])},
    "fx": {"enabled": ("boolean", None), "base": ("string", None), "quote": ("string", None)},
    "news": {"enabled": ("boolean", None), "url": ("string", None), "max_items": ("integer", (1, 30))},
    "onthisday": {"enabled": ("boolean", None), "lang": ("string", None)},
    "recent": {"enabled": ("boolean", None), "max_items": ("integer", (1, 50))},
    "github": {"enabled": ("boolean", None), "gh_path": ("string", None)},
    "rfc": {"enabled": ("boolean", None), "repo": ("string?", None), "dir": ("string", None), "file_prefix": ("string", None),
            "status_label": ("string", None), "pending_text": ("string", None), "user_action_text": ("string?", None)},
    **{k: {"enabled": ("boolean", None)} for k in ("iss", "bluetooth", "launches", "kp", "contrib", "sessions")},
}

SIGNAL_PROVIDER = {"weather": "weather", "nowPlaying": "now_playing", "claudeUsage": "claude_usage",
                   **{n: v[1] for n, v in GENERIC_SIGNALS.items() if v[1]}}


def _validate_providers(given, errors: list, warnings: list) -> dict:
    out = copy.deepcopy(DEFAULT_PROVIDERS)
    if given is None:
        return out
    if not isinstance(given, dict):
        errors.append("providers: must be a mapping")
        return out
    for name, block in given.items():
        if name not in PROVIDER_SCHEMA:
            errors.append(f"providers.{name}: unknown provider (known: {', '.join(PROVIDER_SCHEMA)})")
            continue
        if block is None:
            continue
        if not isinstance(block, dict):
            errors.append(f"providers.{name}: must be a mapping")
            continue
        for k, v in block.items():
            w = f"providers.{name}.{k}"
            if k not in PROVIDER_SCHEMA[name]:
                errors.append(f"{w}: unknown key (known: {', '.join(PROVIDER_SCHEMA[name])})")
                continue
            t, extra = PROVIDER_SCHEMA[name][k]
            if t == "string?" and v is None:
                out[name][k] = None
                continue
            spec = {"type": t.rstrip("?")}
            if t == "enum":
                spec["options"] = extra
            elif extra:
                spec["min"], spec["max"] = extra
            if _check_value(spec, v, w, errors):
                out[name][k] = v
    # ping targets: [{name, host, port?, method?}]
    targets = []
    for i, tg in enumerate(out["ping"]["targets"] or []):
        w = f"providers.ping.targets[{i}]"
        if not isinstance(tg, dict) or not isinstance(tg.get("name"), str) or not isinstance(tg.get("host"), str):
            errors.append(f"{w}: needs 'name' and 'host'")
            continue
        if not HOST_RE.match(tg["host"]) or tg["host"].startswith("-"):
            errors.append(f"{w}.host: not a valid host name / IP")
            continue
        port = tg.get("port", 22)
        method = tg.get("method", "icmp")
        if not isinstance(port, int) or not 1 <= port <= 65535:
            errors.append(f"{w}.port: must be 1..65535")
            continue
        if method not in ("icmp", "tcp"):
            errors.append(f"{w}.method: must be icmp or tcp")
            continue
        targets.append({"name": tg["name"][:24], "host": tg["host"], "port": port, "method": method})
    out["ping"]["targets"] = targets
    for p in out["now_playing"]["players"]:
        if p not in ("music", "spotify"):
            errors.append(f"providers.now_playing.players: unknown player {p!r} (music, spotify)")
    if out["location"]["mode"] == "ip":
        warnings.append("providers.location.mode is 'ip': your public IP is sent to ipinfo.io every 30 minutes")
    if out["claude_usage"]["enabled"]:
        warnings.append("providers.claude_usage is enabled: reads an UNDOCUMENTED field of ~/.claude.json; may break at any time")
    _validate_extra_providers(out, errors, warnings)
    return out


def _validate_extra_providers(out: dict, errors: list, warnings: list):
    """Cross-field checks for the panel providers (mac, network, quakes, fx, news, rfc, ...)."""
    if isinstance(out["quakes"]["min_intensity"], int):  # YAML 3 instead of "3"
        out["quakes"]["min_intensity"] = str(out["quakes"]["min_intensity"])
    net = out["network"]
    if net["home_subnet"] is not None:
        try:
            ipaddress.ip_network(net["home_subnet"], strict=False)
        except ValueError:
            errors.append(f"providers.network.home_subnet: not a subnet like \"192.168.1.0/24\": {net['home_subnet']!r}")
            net["home_subnet"] = None
    mounts = []
    for i, m in enumerate(net["mounts"] or []):
        if isinstance(m, str) and 0 < len(m) <= 80 and "/" not in m:
            mounts.append(m)
        else:
            errors.append(f"providers.network.mounts[{i}]: expected a share name (no slashes), got {m!r}")
    net["mounts"] = mounts
    if not re.match(r"^(auto|[a-z0-9]{1,15})$", net["home_interface"]):
        errors.append("providers.network.home_interface: expected auto or an interface name like en0")
        net["home_interface"] = "auto"
    for k in ("base", "quote"):
        if not CURRENCY_RE.match(out["fx"][k]):
            errors.append(f"providers.fx.{k}: expected a 3-letter currency code like USD")
            out["fx"]["enabled"] = False
    if not out["news"]["url"].startswith("https://"):
        errors.append("providers.news.url: must be an https:// URL")
        out["news"]["enabled"] = False
    if not re.match(r"^[a-z]{2,3}(-[a-z]{2,4})?$", out["onthisday"]["lang"]):
        errors.append("providers.onthisday.lang: expected a Wikipedia language code like ja or en")
        out["onthisday"]["lang"] = "ja"
    rfc = out["rfc"]
    if rfc["enabled"]:
        if not (isinstance(rfc["repo"], str) and GITHUB_REPO_RE.match(rfc["repo"])):
            errors.append("providers.rfc.repo: required when enabled, as owner/name")
            rfc["enabled"] = False
        if not REPO_DIR_RE.match(rfc["dir"]) or ".." in rfc["dir"]:
            errors.append("providers.rfc.dir: expected a folder path inside the repo")
            rfc["enabled"] = False
        if not rfc["status_label"] or not rfc["pending_text"]:
            errors.append("providers.rfc: status_label and pending_text must not be empty")
            rfc["enabled"] = False
    if out["github"]["gh_path"].startswith("-") or not out["github"]["gh_path"].strip():
        errors.append("providers.github.gh_path: expected gh or a path to the gh binary")
        out["github"]["gh_path"] = "gh"
    gh = [k for k in ("github", "contrib", "rfc") if out[k]["enabled"]]
    if gh:
        warnings.append(f"providers {', '.join(gh)}: use your gh login and show GitHub data on the desktop")
    if out["sessions"]["enabled"]:
        warnings.append("providers.sessions is enabled: shows the folder names of running Claude Code sessions")


def _validate_theme(given, errors: list) -> dict:
    out = dict(DEFAULT_THEME)
    if given is None:
        return out
    if not isinstance(given, dict):
        errors.append("theme: must be a mapping")
        return out
    for k, v in given.items():
        w = f"theme.{k}"
        if k not in DEFAULT_THEME:
            errors.append(f"{w}: unknown key (known: {', '.join(DEFAULT_THEME)})")
        elif k in ("font", "mono_font"):
            if not isinstance(v, str) or not FONT_RE.match(v):
                errors.append(f"{w}: must be a CSS font-family list of locally installed fonts")
            else:
                out[k] = v
        elif k == "accent":
            if v != "auto" and not (isinstance(v, str) and COLOR_RE.match(v)):
                errors.append(f"{w}: must be 'auto' or a quoted colour like \"#46dcc8\"")
            else:
                out[k] = v
        elif k == "text_color":
            if _check_value({"type": "color"}, v, w, errors):
                out[k] = v
        elif k == "locale":
            if not isinstance(v, str) or not LOCALE_RE.match(v):
                errors.append(f"{w}: must be 'auto' or a BCP-47 tag like ja-JP / en-US")
            else:
                out[k] = v
        elif k in ("hour12", "night_dim"):
            if _check_value({"type": "boolean"}, v, w, errors):
                out[k] = v
    return out


def _validate_position(pos, defaults: dict, where: str, errors: list) -> dict:
    out = {"anchor": "top-left", "x": 0, "y": 0, "width": defaults.get("width", "auto"),
           "height": defaults.get("height", "auto"), "z": 0}
    if pos is None:
        return out
    if isinstance(pos, str):
        pos = {"anchor": pos}
    if not isinstance(pos, dict):
        errors.append(f"{where}: must be an anchor name or a mapping")
        return out
    for k, v in pos.items():
        w = f"{where}.{k}"
        if k == "anchor":
            if v not in ANCHORS:
                errors.append(f"{w}: must be one of {', '.join(sorted(ANCHORS))}")
            else:
                out[k] = v
        elif k in ("x", "y", "width", "height"):
            if k in ("width", "height") and v == "auto":
                out[k] = v
            elif isinstance(v, bool) or not (isinstance(v, (int, float)) or (isinstance(v, str) and LENGTH_RE.match(v))):
                errors.append(f"{w}: must be a CSS length like 24, \"24px\", \"6vw\", \"11vh\"" + (" or 'auto'" if k in ("width", "height") else ""))
            else:
                out[k] = v
        elif k == "z":
            if _check_value({"type": "integer", "min": -10, "max": 100}, v, w, errors):
                out[k] = v
        else:
            errors.append(f"{w}: unknown key (anchor, x, y, width, height, z)")
    return out


ZONE_KEYS = {"anchor": ("enum", sorted(ANCHORS)), "x": "length", "y": "length", "width": "length", "height": "length",
             "gap": "length", "columns": ("integer", (1, 4)), "column_gap": "length", "rotate_seconds": ("integer", (5, 3600))}


def _validate_zones(given, errors: list) -> dict:
    """zones: named areas whose widgets flow vertically (no overlaps). A zone with `rotate_seconds` holds
    pages of `columns` columns that crossfade (widgets pick `page` and `column`)."""
    out = {}
    if given is None:
        return out
    if not isinstance(given, dict):
        errors.append("zones: must be a mapping of zone name -> settings")
        return out
    for name, z in given.items():
        w = f"zones.{name}"
        if not isinstance(name, str) or not re.match(r"^[a-z][a-z0-9-]{0,30}$", name):
            errors.append(f"{w}: zone names must be lowercase ids")
            continue
        if not isinstance(z, dict):
            errors.append(f"{w}: must be a mapping")
            continue
        r = {"anchor": "top-left", "x": 0, "y": 0, "width": "20vw", "height": "auto", "gap": "3.4vh",
             "columns": 1, "column_gap": "3vw", "rotate_seconds": None}
        ok = True
        for k, v in z.items():
            if k not in ZONE_KEYS:
                errors.append(f"{w}.{k}: unknown key (known: {', '.join(ZONE_KEYS)})")
                ok = False
                continue
            t = ZONE_KEYS[k]
            if t == "length":
                if k == "height" and v == "auto":
                    r[k] = v
                elif isinstance(v, bool) or not (isinstance(v, (int, float)) or (isinstance(v, str) and LENGTH_RE.match(v))):
                    errors.append(f"{w}.{k}: must be a CSS length like \"6vw\"")
                    ok = False
                else:
                    r[k] = v
            elif t[0] == "enum":
                if v not in t[1]:
                    errors.append(f"{w}.{k}: must be one of {', '.join(t[1])}")
                    ok = False
                else:
                    r[k] = v
            elif _check_value({"type": "integer", "min": t[1][0], "max": t[1][1]}, v, f"{w}.{k}", errors):
                r[k] = v
            else:
                ok = False
        if ok:
            out[name] = r
    return out


def validate_layout(cfg, plugins: dict) -> dict:
    """Validate a parsed layout.yaml. Returns the resolved config incl. errors/warnings."""
    errors, warnings = [], []
    if cfg is None:
        cfg = {}
    if not isinstance(cfg, dict):
        return {"errors": ["layout.yaml: top level must be a mapping"], "warnings": [], "widgets": [], "zones": {},
                "theme": dict(DEFAULT_THEME), "background": None, "providers": copy.deepcopy(DEFAULT_PROVIDERS)}
    for k in sorted(set(cfg) - {"version", "theme", "background", "widgets", "providers", "zones"}):
        errors.append(f"{k}: unknown top-level key (version, theme, background, widgets, providers, zones)")
    if cfg.get("version", 1) != 1:
        errors.append("version: only version 1 is supported")
    theme = _validate_theme(cfg.get("theme"), errors)
    providers = _validate_providers(cfg.get("providers"), errors, warnings)
    zones = _validate_zones(cfg.get("zones"), errors)

    # background
    bg_in = cfg.get("background")
    if bg_in is None:
        bg_in = {"use": "color"}
    if isinstance(bg_in, str):
        bg_in = {"use": bg_in}
    background = None
    if not isinstance(bg_in, dict):
        errors.append("background: must be a mapping with 'use'")
    else:
        for k in sorted(set(bg_in) - {"use", "settings", "react"}):
            errors.append(f"background.{k}: unknown key (use, settings, react)")
        use = bg_in.get("use")
        m = BUILTIN_BACKGROUNDS.get(use) or plugins.get(use)
        if not m:
            errors.append(f"background.use: unknown background {use!r} (built-in: {', '.join(BUILTIN_BACKGROUNDS)}; "
                          f"plugins: {', '.join(i for i, p in plugins.items() if p['kind'] == 'background') or 'none'})")
        elif m["kind"] != "background":
            errors.append(f"background.use: {use!r} is a widget, not a background")
        else:
            settings = apply_settings(m.get("settings"), bg_in.get("settings"), "background.settings", errors, warnings)
            hooks = (m.get("reactions") or {}).get("hooks") or {}
            if bg_in.get("react") is not None:
                if not hooks:
                    errors.append(f"background.react: {use!r} does not support reactions")
                    react = {}
                else:
                    react = _validate_react(bg_in["react"], hooks, "background.react", errors)
            else:
                react = (m.get("reactions") or {}).get("default") or {}
            background = {"use": use, "builtin": bool(m.get("builtin")), "name": m.get("name"),
                          "needs": list(m.get("needs") or []), "settings": settings, "react": react,
                          "assets": list(m.get("assets") or []), "unofficial": m.get("unofficial", False),
                          "hooks": sorted(hooks)}
            if use in ("image", "video"):
                if not settings.get("path"):
                    errors.append(f"background.settings.path: required for the {use} background")
                elif not media_path_for(background):
                    errors.append(f"background.settings.path: {settings['path']!r} does not exist or is not a supported "
                                  f"{use} file ({', '.join(sorted(IMAGE_EXT if use == 'image' else VIDEO_EXT))})")
            if use == "gradient" and len(settings.get("stops") or []) < 2:
                errors.append("background.settings.stops: needs at least 2 colours")

    # widgets
    widgets = []
    wl = cfg.get("widgets") or []
    if not isinstance(wl, list):
        errors.append("widgets: must be a list")
        wl = []
    for i, w in enumerate(wl):
        where = f"widgets[{i}]"
        if isinstance(w, str):
            w = {"use": w}
        if not isinstance(w, dict):
            errors.append(f"{where}: must be a mapping with 'use'")
            continue
        for k in sorted(set(w) - {"use", "position", "settings", "id", "zone", "page", "column", "dim"}):
            errors.append(f"{where}.{k}: unknown key (use, position, settings, id, zone, page, column, dim)")
        use = w.get("use")
        m = plugins.get(use)
        if not m:
            errors.append(f"{where}.use: unknown widget {use!r} (installed: {', '.join(i for i, p in plugins.items() if p['kind'] == 'widget')})")
            continue
        if m["kind"] != "widget":
            errors.append(f"{where}.use: {use!r} is a background; put it under background.use")
            continue
        n0 = len(errors)
        settings = apply_settings(m.get("settings"), w.get("settings"), f"{where}.settings ({use})", errors, warnings)
        position = _validate_position(w.get("position"), m.get("default_size") or {}, f"{where}.position", errors)
        zone, page, column = w.get("zone"), w.get("page", 0), w.get("column", 0)
        if zone is not None:
            if zone not in zones:
                errors.append(f"{where}.zone: unknown zone {zone!r} (defined: {', '.join(zones) or 'none'})")
            else:
                _check_value({"type": "integer", "min": 0, "max": 40}, page, f"{where}.page", errors)
                _check_value({"type": "integer", "min": 0, "max": zones[zone]["columns"] - 1}, column, f"{where}.column", errors)
        _check_value({"type": "boolean"}, w.get("dim", True), f"{where}.dim", errors)
        if len(errors) > n0:
            continue  # skip only the broken widget; the rest of the desktop still renders
        for s in m["needs"]:
            prov = SIGNAL_PROVIDER.get(s)
            if prov and not providers[prov]["enabled"]:
                warnings.append(f"{where} ({use}) needs '{s}' but providers.{prov}.enabled is false - it will stay empty")
        if m.get("unofficial"):
            warnings.append(f"{where} ({use}) is an UNOFFICIAL plugin (relies on undocumented data)")
        widgets.append({"instance": f"w{i}", "use": use, "name": m.get("name"), "needs": list(m["needs"]),
                        "settings": settings, "position": position, "assets": list(m.get("assets") or []),
                        "zone": zone if zone in zones else None, "page": page if zone else 0,
                        "column": column if zone else 0, "dim": w.get("dim", True) is not False})
    if background:
        for s in background["needs"]:
            prov = SIGNAL_PROVIDER.get(s)
            if prov and not providers[prov]["enabled"]:
                warnings.append(f"background ({background['use']}) needs '{s}' but providers.{prov}.enabled is false")
    return {"theme": theme, "background": background, "widgets": widgets, "providers": providers,
            "zones": zones, "errors": errors, "warnings": warnings}


def load_layout(path: str, plugins: dict) -> dict:
    try:
        cfg = miniyaml.load_file(path)
    except FileNotFoundError:
        res = validate_layout({}, plugins)
        res["errors"].insert(0, f"config file not found: {path}")
        return res
    except (miniyaml.YamlError, UnicodeDecodeError) as e:
        res = validate_layout({}, plugins)
        res["errors"].insert(0, f"{os.path.basename(path)}: {e}")
        return res
    return validate_layout(cfg, plugins)
