"""miniyaml - a small, safe parser for the YAML subset Orbit Desktop uses.

Why not PyYAML? The dev server and tools/validate.py are stdlib-only, and the
runtime must never touch the network, so we parse YAML on the host side and
hand the browser plain JSON. Configuration files are small and simple, so a
strict subset is enough - and a subset that cannot construct objects, follow
aliases or include files is easier to reason about.

Supported
  * block mappings (``key: value``) and block sequences (``- item``), nested
    by indentation (spaces only)
  * flow sequences ``[a, b]`` and flow mappings ``{x: 1, y: 2}`` on one line
  * scalars: null / ~, true / false, integers, floats, 'single' and "double"
    quoted strings (JSON-style escapes), plain strings
  * ``#`` comments (at line start or after whitespace)
  * a single optional leading ``---``

Rejected with a clear error
  * anchors (&), aliases (*), tags (!), block scalars (| and >),
    multiple documents, tabs in indentation, duplicate keys
"""
from __future__ import annotations

import json
import re

MAX_BYTES = 512 * 1024
MAX_DEPTH = 32

_INT = re.compile(r"^[-+]?[0-9]+$")
_FLOAT = re.compile(r"^[-+]?([0-9]+\.[0-9]*|\.[0-9]+|[0-9]+)([eE][-+]?[0-9]+)?$")


class YamlError(ValueError):
    def __init__(self, msg: str, line: int | None = None):
        self.line = line
        super().__init__(f"line {line}: {msg}" if line else msg)


def _strip_comment(s: str, lineno: int) -> str:
    """Remove a trailing comment, respecting quotes."""
    quote = None
    i = 0
    while i < len(s):
        c = s[i]
        if quote:
            if quote == '"' and c == "\\":
                i += 2
                continue
            if c == quote:
                if quote == "'" and i + 1 < len(s) and s[i + 1] == "'":
                    i += 2
                    continue
                quote = None
        elif c in "'\"":
            # quotes only open a quoted scalar at token start
            prev = s[i - 1] if i else " "
            if prev in " \t[{,:-":
                quote = c
        elif c == "#" and (i == 0 or s[i - 1] in " \t"):
            return s[:i].rstrip()
        i += 1
    if quote:
        raise YamlError("unterminated quoted string", lineno)
    return s.rstrip()


def _scalar(tok: str, lineno: int):
    t = tok.strip()
    if t == "":
        return None
    c = t[0]
    if c == '"':
        if not t.endswith('"') or len(t) < 2:
            raise YamlError(f"bad double-quoted string: {t}", lineno)
        try:
            return json.loads(t)
        except ValueError:
            raise YamlError(f"bad escape in string: {t}", lineno) from None
    if c == "'":
        if not t.endswith("'") or len(t) < 2:
            raise YamlError(f"bad single-quoted string: {t}", lineno)
        return t[1:-1].replace("''", "'")
    if c in "&*!":
        raise YamlError("anchors, aliases and tags are not supported", lineno)
    if c in "|>":
        raise YamlError("block scalars (| and >) are not supported; use a quoted string", lineno)
    if c in "@`":
        raise YamlError(f"plain scalars cannot start with {c!r}; quote the value", lineno)
    if t in ("null", "Null", "NULL", "~"):
        return None
    if t in ("true", "True", "TRUE"):
        return True
    if t in ("false", "False", "FALSE"):
        return False
    if _INT.match(t):
        return int(t)
    if _FLOAT.match(t):
        return float(t)
    return t


class _Flow:
    """Recursive-descent parser for one-line flow collections."""

    def __init__(self, s: str, lineno: int):
        self.s, self.i, self.line = s, 0, lineno

    def ws(self):
        while self.i < len(self.s) and self.s[self.i] in " \t":
            self.i += 1

    def parse(self, depth=0):
        if depth > MAX_DEPTH:
            raise YamlError("nesting too deep", self.line)
        self.ws()
        if self.i >= len(self.s):
            raise YamlError("unexpected end of flow collection", self.line)
        c = self.s[self.i]
        if c == "[":
            self.i += 1
            out = []
            self.ws()
            if self.peek() == "]":
                self.i += 1
                return out
            while True:
                out.append(self.parse(depth + 1))
                self.ws()
                c = self.take()
                if c == "]":
                    return out
                if c != ",":
                    raise YamlError("expected ',' or ']' in flow sequence", self.line)
        if c == "{":
            self.i += 1
            out = {}
            self.ws()
            if self.peek() == "}":
                self.i += 1
                return out
            while True:
                self.ws()
                k = self.token(":")
                key = _scalar(k, self.line)
                if not isinstance(key, str):
                    key = str(key)
                if self.take() != ":":
                    raise YamlError("expected ':' in flow mapping", self.line)
                if key in out:
                    raise YamlError(f"duplicate key {key!r}", self.line)
                out[key] = self.parse(depth + 1)
                self.ws()
                c = self.take()
                if c == "}":
                    return out
                if c != ",":
                    raise YamlError("expected ',' or '}' in flow mapping", self.line)
        return _scalar(self.token(",]}"), self.line)

    def peek(self):
        return self.s[self.i] if self.i < len(self.s) else ""

    def take(self):
        c = self.peek()
        self.i += 1
        return c

    def token(self, stops: str) -> str:
        self.ws()
        start = self.i
        if self.peek() in "'\"":
            q = self.take()
            while self.i < len(self.s):
                c = self.take()
                if q == '"' and c == "\\":
                    self.i += 1
                elif c == q:
                    if q == "'" and self.peek() == "'":
                        self.i += 1
                        continue
                    break
            return self.s[start:self.i]
        while self.i < len(self.s) and self.s[self.i] not in stops:
            if self.s[self.i] in "[{":
                raise YamlError("unexpected bracket in plain scalar", self.line)
            self.i += 1
        return self.s[start:self.i].strip()


def _value(text: str, lineno: int):
    t = text.strip()
    if t[:1] in "[{":
        f = _Flow(t, lineno)
        v = f.parse()
        f.ws()
        if f.i != len(t):
            raise YamlError("trailing characters after flow collection", lineno)
        return v
    return _scalar(t, lineno)


def _split_key(content: str, lineno: int):
    """Return (key, rest) if the line is a mapping entry, else None."""
    i = 0
    if content[:1] in "'\"":
        q = content[0]
        i = 1
        while i < len(content):
            if q == '"' and content[i] == "\\":
                i += 2
                continue
            if content[i] == q:
                if q == "'" and content[i + 1:i + 2] == "'":
                    i += 2
                    continue
                break
            i += 1
        i += 1
        if content[i:i + 1] != ":":
            return None
        key = _scalar(content[:i], lineno)
        return str(key), content[i + 1:]
    if content[:1] in "[{":
        return None
    while i < len(content):
        if content[i] == ":" and (i + 1 == len(content) or content[i + 1] == " "):
            key = content[:i].strip()
            if not key:
                raise YamlError("empty key", lineno)
            if key[0] in "&*!|>":
                raise YamlError("anchors, aliases, tags and complex keys are not supported", lineno)
            return key, content[i + 1:]
        i += 1
    return None


class _Block:
    def __init__(self, lines):
        self.lines = lines  # list of [indent, content, lineno]
        self.i = 0

    def cur(self):
        return self.lines[self.i] if self.i < len(self.lines) else None

    def parse(self, indent: int, depth: int):
        if depth > MAX_DEPTH:
            raise YamlError("nesting too deep", self.cur()[2])
        ln = self.cur()
        if ln[1] == "-" or ln[1].startswith("- "):
            return self.seq(indent, depth)
        if _split_key(ln[1], ln[2]) is not None:
            return self.map(indent, depth)
        # a lone scalar / flow collection
        self.i += 1
        v = _value(ln[1], ln[2])
        nxt = self.cur()
        if nxt and nxt[0] >= indent:
            raise YamlError("unexpected content after value", nxt[2])
        return v

    def child(self, parent_indent: int, depth: int, lineno: int):
        nxt = self.cur()
        if nxt is None or nxt[0] <= parent_indent:
            return None
        return self.parse(nxt[0], depth + 1)

    def seq(self, indent: int, depth: int):
        out = []
        while True:
            ln = self.cur()
            if ln is None or ln[0] < indent:
                return out
            if ln[0] > indent:
                raise YamlError("bad indentation", ln[2])
            content = ln[1]
            if not (content == "-" or content.startswith("- ")):
                if _split_key(content, ln[2]) is not None:
                    return out  # `key:\n- a\nnext_key:` (sequence at the parent's indent)
                raise YamlError("expected '- ' sequence item", ln[2])
            rest = content[1:]
            stripped = rest.lstrip(" ")
            if stripped == "":
                self.i += 1
                out.append(self.child(indent, depth, ln[2]))
                continue
            col = indent + 1 + (len(rest) - len(stripped))
            if stripped == "-" or stripped.startswith("- ") or _split_key(stripped, ln[2]) is not None:
                # nested block starts on the same line as the dash: re-anchor it
                ln[0], ln[1] = col, stripped
                out.append(self.parse(col, depth + 1))
            else:
                self.i += 1
                out.append(_value(stripped, ln[2]))
                nxt = self.cur()
                if nxt and nxt[0] > indent:
                    raise YamlError("bad indentation", nxt[2])

    def map(self, indent: int, depth: int):
        out = {}
        while True:
            ln = self.cur()
            if ln is None or ln[0] < indent:
                return out
            if ln[0] > indent:
                raise YamlError("bad indentation", ln[2])
            kv = _split_key(ln[1], ln[2])
            if kv is None:
                if ln[1] == "-" or ln[1].startswith("- "):
                    raise YamlError("sequence item where a 'key: value' was expected", ln[2])
                raise YamlError("expected 'key: value'", ln[2])
            key, rest = kv
            if key in out:
                raise YamlError(f"duplicate key {key!r}", ln[2])
            self.i += 1
            if rest.strip() == "":
                nxt = self.cur()
                if nxt and nxt[0] == indent and (nxt[1] == "-" or nxt[1].startswith("- ")):
                    out[key] = self.seq(indent, depth + 1)
                else:
                    out[key] = self.child(indent, depth, ln[2])
            else:
                out[key] = _value(rest, ln[2])
                nxt = self.cur()
                if nxt and nxt[0] > indent:
                    raise YamlError("bad indentation (value already given on the previous line)", nxt[2])


def loads(text: str):
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise YamlError(f"file larger than {MAX_BYTES} bytes")
    if text.startswith("﻿"):
        text = text[1:]
    lines = []
    seen_doc = False
    for n, raw in enumerate(text.splitlines(), 1):
        body = raw.rstrip()
        stripped = body.lstrip(" ")
        if stripped.startswith("\t") or (body[:1] == "\t"):
            raise YamlError("tabs are not allowed for indentation", n)
        if stripped == "" or stripped.startswith("#"):
            continue
        if stripped in ("---", "...") or stripped.startswith("--- "):
            if lines or seen_doc or stripped == "...":
                raise YamlError("multiple documents are not supported", n)
            seen_doc = True
            continue
        if stripped.startswith("%"):
            raise YamlError("directives are not supported", n)
        indent = len(body) - len(stripped)
        content = _strip_comment(stripped, n)
        if content:
            lines.append([indent, content, n])
    if not lines:
        return None
    b = _Block(lines)
    v = b.parse(lines[0][0], 0)
    if b.cur() is not None:
        raise YamlError("bad indentation", b.cur()[2])
    return v


def load_file(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return loads(f.read(MAX_BYTES + 1))
