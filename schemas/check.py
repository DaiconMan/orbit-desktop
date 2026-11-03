#!/usr/bin/env python3
"""Check the signal contracts in schemas/ (stdlib only).

    python3 schemas/check.py                       # mocks + index + widget manifests
    python3 schemas/check.py --live http://127.0.0.1:47900   # also the running server's payloads

What it checks:
  * schemas/signals/index.json lists every signal in orbit_config.SIGNALS, each with a schema file
  * every examples/mock/<name>.json validates against schemas/signals/<name>.schema.json
  * examples/mock/all.json holds exactly those payloads (the dev server's --mock format)
  * every widgets/*/widget.yaml validates against schemas/widget.schema.json
  * --live: every signal the server serves (404 = provider disabled and `null` = no data yet are skipped)

The validator implements the JSON Schema 2020-12 subset these schemas use: type (incl. type arrays for
nullable values), properties, required, additionalProperties, patternProperties, propertyNames, items,
prefixItems, minItems, maxItems, uniqueItems, enum, const, minimum, maximum, exclusiveMinimum,
exclusiveMaximum, minLength, maxLength, pattern, anyOf, oneOf, allOf, not, if/then/else and local $ref.
`format` and annotations are ignored. Exit status 1 on any error.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SIGNAL_DIR = os.path.join(HERE, "signals")
MOCK_DIR = os.path.join(ROOT, "examples", "mock")
DEV_SERVER = os.path.join(ROOT, "host", "dev-server")


# --------------------------------------------------------------------------- mini validator
def _is_type(v, t):
    if t == "null":
        return v is None
    if t == "boolean":
        return isinstance(v, bool)
    if t == "integer":
        return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == "string":
        return isinstance(v, str)
    if t == "array":
        return isinstance(v, list)
    if t == "object":
        return isinstance(v, dict)
    raise ValueError(f"unsupported type {t!r} in schema")


def _resolve(root, ref):
    if not ref.startswith("#"):
        raise ValueError(f"only local $ref is supported, got {ref!r}")
    node = root
    for part in [p for p in ref[1:].split("/") if p]:
        node = node[part.replace("~1", "/").replace("~0", "~")]
    return node


def validate(value, schema, path="$", root=None):
    """Return a list of 'path: message' strings (empty = valid)."""
    root = root if root is not None else schema
    if schema is True:
        return []
    if schema is False:
        return [f"{path}: not allowed here"]
    errs = []
    if "$ref" in schema:
        errs += validate(value, _resolve(root, schema["$ref"]), path, root)
    t = schema.get("type")
    if t is not None:
        ts = t if isinstance(t, list) else [t]
        if not any(_is_type(value, x) for x in ts):
            return errs + [f"{path}: expected {'/'.join(ts)}, got {type(value).__name__} {_short(value)}"]
    if "enum" in schema and value not in schema["enum"]:
        errs.append(f"{path}: {_short(value)} is not one of {schema['enum']}")
    if "const" in schema and value != schema["const"]:
        errs.append(f"{path}: must be {schema['const']!r}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errs.append(f"{path}: {value} < minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errs.append(f"{path}: {value} > maximum {schema['maximum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errs.append(f"{path}: {value} <= exclusiveMinimum {schema['exclusiveMinimum']}")
        if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
            errs.append(f"{path}: {value} >= exclusiveMaximum {schema['exclusiveMaximum']}")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errs.append(f"{path}: shorter than {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errs.append(f"{path}: longer than {schema['maxLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errs.append(f"{path}: {_short(value)} does not match {schema['pattern']}")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for k in schema.get("required", []):
            if k not in value:
                errs.append(f"{path}: missing required key {k!r}")
        pats = schema.get("patternProperties", {})
        for k, v in value.items():
            sub = f"{path}.{k}"
            if "propertyNames" in schema:
                errs += [e.replace(path + ":", f"{path}: key {k!r}:", 1)
                         for e in validate(k, schema["propertyNames"], path, root)]
            matched = False
            if k in props:
                matched = True
                errs += validate(v, props[k], sub, root)
            for p, ps in pats.items():
                if re.search(p, k):
                    matched = True
                    errs += validate(v, ps, sub, root)
            if not matched and "additionalProperties" in schema:
                ap = schema["additionalProperties"]
                if ap is False:
                    errs.append(f"{path}: unexpected key {k!r}")
                elif isinstance(ap, dict):
                    errs += validate(v, ap, sub, root)
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errs.append(f"{path}: fewer than {schema['minItems']} items ({len(value)})")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errs.append(f"{path}: more than {schema['maxItems']} items ({len(value)})")
        if schema.get("uniqueItems"):
            seen = [json.dumps(x, sort_keys=True) for x in value]
            if len(set(seen)) != len(seen):
                errs.append(f"{path}: items must be unique")
        pre = schema.get("prefixItems", [])
        for i, v in enumerate(value):
            if i < len(pre):
                errs += validate(v, pre[i], f"{path}[{i}]", root)
            elif "items" in schema:
                errs += validate(v, schema["items"], f"{path}[{i}]", root)
    for sub in schema.get("allOf", []):
        errs += validate(value, sub, path, root)
    if "anyOf" in schema:
        results = [validate(value, sub, path, root) for sub in schema["anyOf"]]
        if all(results):
            errs.append(f"{path}: matches none of anyOf ({'; '.join(r[0] for r in results)})")
    if "oneOf" in schema:
        results = [validate(value, sub, path, root) for sub in schema["oneOf"]]
        n = sum(1 for r in results if not r)
        if n != 1:
            errs.append(f"{path}: must match exactly one of oneOf, matched {n}")
    if "not" in schema and not validate(value, schema["not"], path, root):
        errs.append(f"{path}: matches a forbidden ('not') pattern")
    if "if" in schema:
        if not validate(value, schema["if"], path, root):
            if "then" in schema:
                errs += validate(value, schema["then"], path, root)
        elif "else" in schema:
            errs += validate(value, schema["else"], path, root)
    return errs


def _short(v):
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) <= 60 else s[:57] + "..."


# --------------------------------------------------------------------------- checks
def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_index(problems):
    index = load_json(os.path.join(SIGNAL_DIR, "index.json"))
    schemas = {}
    for e in index:
        try:
            schemas[e["name"]] = load_json(os.path.join(SIGNAL_DIR, e["schema"]))
        except (OSError, ValueError) as ex:
            problems.append(f"index: {e.get('name')}: cannot load schema: {ex}")
    sys.path.insert(0, DEV_SERVER)
    try:
        import orbit_config as oc
        names = {e["name"] for e in index}
        for n in sorted(set(oc.SIGNALS) - names):
            problems.append(f"index: signal {n!r} (orbit_config.SIGNALS) has no entry")
        for n in sorted(names - set(oc.SIGNALS)):
            problems.append(f"index: {n!r} is not a signal in orbit_config.SIGNALS")
        for e in index:
            if bool(e.get("sensitive")) != (e["name"] in oc.SENSITIVE_SIGNALS):
                problems.append(f"index: {e['name']}: sensitive flag differs from orbit_config.SENSITIVE_SIGNALS")
            g = oc.GENERIC_SIGNALS.get(e["name"])
            if g and (e["path"] != f"/api/signals/{g[0]}" or e["provider"] != g[1] or e["interval_ms"] != g[2]):
                problems.append(f"index: {e['name']}: path/provider/interval differ from orbit_config.GENERIC_SIGNALS")
    except ImportError as ex:
        print(f"note: orbit_config not importable ({ex}); index not compared with the code")
    return index, schemas


def check_mocks(index, schemas, problems):
    payloads = {}
    for e in index:
        name = e["name"]
        p = os.path.join(MOCK_DIR, f"{name}.json")
        try:
            payloads[name] = v = load_json(p)
        except (OSError, ValueError) as ex:
            problems.append(f"mock {name}: {ex}")
            continue
        errs = validate(v, schemas.get(name, True))
        problems += [f"mock {name}: {x}" for x in errs]
        print(f"  mock {name:<12} {'ok' if not errs else f'{len(errs)} error(s)'}")
        # variants: examples/mock/<name>.<variant>.json (e.g. alerts.eew-test.json), not part of all.json
        for fn in sorted(os.listdir(MOCK_DIR)):
            if fn.startswith(name + ".") and fn.endswith(".json") and fn != f"{name}.json":
                try:
                    errs = validate(load_json(os.path.join(MOCK_DIR, fn)), schemas.get(name, True))
                except (OSError, ValueError) as ex:
                    errs = [str(ex)]
                problems += [f"mock {fn}: {x}" for x in errs]
                print(f"  mock {fn:<12} {'ok' if not errs else f'{len(errs)} error(s)'}")
    try:
        allm = load_json(os.path.join(MOCK_DIR, "all.json"))
        for n in sorted(set(payloads) | set(allm)):
            if allm.get(n) != payloads.get(n):
                problems.append(f"mock all.json: {n!r} differs from examples/mock/{n}.json (or is missing)")
    except (OSError, ValueError) as ex:
        problems.append(f"mock all.json: {ex}")


def check_widgets(problems):
    try:
        schema = load_json(os.path.join(HERE, "widget.schema.json"))
        sys.path.insert(0, DEV_SERVER)
        import miniyaml
    except (OSError, ValueError, ImportError) as ex:
        problems.append(f"widget schema: {ex}")
        return
    root = os.path.join(ROOT, "widgets")
    n = 0
    for pid in sorted(os.listdir(root)):
        path = os.path.join(root, pid, "widget.yaml")
        if not os.path.isfile(path):
            continue
        n += 1
        try:
            m = miniyaml.load_file(path)
        except Exception as ex:   # noqa: BLE001 - report any parse error
            problems.append(f"widgets/{pid}/widget.yaml: {ex}")
            continue
        problems += [f"widgets/{pid}/widget.yaml: {x}" for x in validate(m, schema)]
    print(f"  widget.yaml  {n} manifest(s) checked")


def check_live(base, index, schemas, problems):
    for e in index:
        name, path = e["name"], e["path"]
        if path == "runtime":
            print(f"  live {name:<12} skipped (generated by the runtime page)")
            continue
        if path == "/api/stream/audio":
            path = "/api/signals/audio"         # snapshot of the SSE stream
        try:
            with urllib.request.urlopen(base.rstrip("/") + path, timeout=10) as r:
                body = json.loads(r.read() or b"null")
        except urllib.error.HTTPError as ex:
            print(f"  live {name:<12} skipped (HTTP {ex.code}: provider disabled)" if ex.code == 404
                  else f"  live {name:<12} HTTP {ex.code}")
            if ex.code != 404:
                problems.append(f"live {name}: HTTP {ex.code}")
            continue
        except (OSError, ValueError) as ex:
            problems.append(f"live {name}: {ex}")
            continue
        if body is None:
            print(f"  live {name:<12} skipped (null: no data yet)")
            continue
        errs = validate(body, schemas.get(name, True))
        problems += [f"live {name}: {x}" for x in errs]
        print(f"  live {name:<12} {'ok' if not errs else f'{len(errs)} error(s)'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--live", metavar="URL", help="also validate a running server, e.g. http://127.0.0.1:47900")
    ap.add_argument("--no-widgets", action="store_true", help="skip the widgets/*/widget.yaml check")
    a = ap.parse_args()
    problems = []
    index, schemas = load_index(problems)
    print(f"signals: {len(index)} in index")
    check_mocks(index, schemas, problems)
    if not a.no_widgets:
        check_widgets(problems)
    if a.live:
        check_live(a.live, index, schemas, problems)
    for p in problems:
        print("ERROR", p)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
