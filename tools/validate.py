#!/usr/bin/env python3
"""Validate every plugin manifest and layout config (stdlib only; used by CI).

  python3 tools/validate.py                      # bundled widgets + examples/layout.yaml
  python3 tools/validate.py path/to/layout.yaml  # also validate extra configs

Checks
  * widget.yaml schema (id/name/version/author/license/kind, needs, settings, assets, reactions)
  * required files (widget.js, README.md) and size limits
  * no unexpected files in plugin folders (keeps PRs reviewable)
  * static red flags in widget.js (network / storage APIs that are blocked by the
    sandbox anyway - a plugin that tries them is a review smell)
  * the YAML-subset parser self-test
  * each layout config validates against the manifests
Exit code 1 on any error.
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "host", "dev-server"))

import miniyaml  # noqa: E402
import orbit_config as oc  # noqa: E402

RED_FLAGS = [
    (r"\bfetch\s*\(", "fetch()"), (r"XMLHttpRequest", "XMLHttpRequest"), (r"\bWebSocket\b", "WebSocket"),
    (r"\bEventSource\b", "EventSource"), (r"sendBeacon", "navigator.sendBeacon"), (r"RTCPeerConnection", "WebRTC"),
    (r"\bimportScripts\b", "importScripts"), (r"\beval\s*\(", "eval()"), (r"new\s+Function\s*\(", "new Function()"),
    (r"localStorage|sessionStorage|indexedDB", "web storage"), (r"document\.cookie", "cookies"),
    (r"(window\.)?top\.location|parent\.location", "navigating the host"), (r"\bwindow\.open\s*\(", "window.open"),
    (r"location\s*(\.href)?\s*=", "self-navigation"), (r"https?://", "hard-coded URL"),
]
EXTRA_OK = {"style.css", "data"}  # data/ may hold assets listed in the manifest


def selftest_yaml(errors):
    cases = {
        "a: 1\nb: [x, 'y z', {c: true}]\nl:\n  - k: v\n    n: 2.5\n  - plain\n": {"a": 1, "b": ["x", "y z", {"c": True}], "l": [{"k": "v", "n": 2.5}, "plain"]},
        "c: \"#46dcc8\"  # colour\nd: ~\n": {"c": "#46dcc8", "d": None},
    }
    for src, want in cases.items():
        got = miniyaml.loads(src)
        if got != want:
            errors.append(f"miniyaml self-test failed: {src!r} -> {got!r}")
    for bad in ("a: &x 1", "a: 1\na: 2", "a: |\n  x", "a: !!python/object x"):
        try:
            miniyaml.loads(bad)
            errors.append(f"miniyaml self-test: {bad!r} should be rejected")
        except miniyaml.YamlError:
            pass


def check_plugin_files(folder, pid, errors, warnings):
    for name in sorted(os.listdir(folder)):
        if name.startswith("."):
            errors.append(f"widgets/{pid}/{name}: hidden files are not allowed")
        elif name not in oc.ALLOWED_PLUGIN_FILES and name not in EXTRA_OK:
            errors.append(f"widgets/{pid}/{name}: unexpected file (allowed: {', '.join(sorted(oc.ALLOWED_PLUGIN_FILES | EXTRA_OK))})")
    js = os.path.join(folder, "widget.js")
    if os.path.isfile(js):
        with open(js, encoding="utf-8") as f:
            src = f.read()
        for rx, what in RED_FLAGS:
            if re.search(rx, src):
                warnings.append(f"widgets/{pid}/widget.js uses {what} - blocked by the sandbox; reviewers: check why")


def main(argv):
    errors, warnings = [], []
    selftest_yaml(errors)
    plugins = oc.discover_plugins(errors, warnings, include_user=False)
    for name in sorted(os.listdir(oc.REPO_WIDGETS)):
        folder = os.path.join(oc.REPO_WIDGETS, name)
        if os.path.isdir(folder):
            check_plugin_files(folder, name, errors, warnings)
    print("plugins: " + ", ".join("%s (%s)" % (p, m["kind"]) for p, m in plugins.items()))
    configs = [oc.EXAMPLE_CONFIG] + argv
    for path in configs:
        res = oc.load_layout(path, plugins)
        rel = os.path.relpath(path, ROOT)
        errors += [f"{rel}: {e}" for e in res["errors"]]
        warnings += [f"{rel}: {w}" for w in res["warnings"]]
        print(f"config {rel}: background={res['background'] and res['background']['use']}, widgets={len(res['widgets'])}")
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    print("OK" if not errors else f"{len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
