#!/usr/bin/env python3
"""Create a new widget plugin from the template (stdlib only).

  python3 tools/new-widget.py my-widget --name "My Widget" --needs time,weather --category weather \\
          [--ja-name 天気メモ] [--dir ~/.config/orbit-desktop/widgets]

Writes <dir>/<id>/{widget.yaml, widget.js, style.css, README.md}. Default dir: widgets/ in this repo.
Then preview it:  python3 tools/dev-widget.py my-widget
"""
from __future__ import annotations

import argparse
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "host", "dev-server"))
import orbit_config as oc  # noqa: E402

JS = '''/* {name}: {description}
   Runs in a sandboxed frame: no network, no storage. Data comes only from the signals in widget.yaml `needs:`.
   Reference: docs/widgets.md, runtime/sdk/orbit-sdk.d.ts, schemas/signals/<signal>.schema.json */
(() => {{
  'use strict';
  const {{ esc, kv }} = Orbit.ui;
  let m = null;                       // the module frame (header + body), the bundled widgets' look

  function render(ctx) {{
    const s = ctx.signals;            // latest value of every needed signal
{render_body}
  }}

  Orbit.widget({{
    mount(ctx) {{
      m = Orbit.module(ctx, '{title}', 'm-{id}');
      ctx.visible(false);             // hidden until there is something to show
    }},
    on: {{
{handlers}
    }},
    theme(ctx) {{ render(ctx); }},     // palette / screen size / scale changed
  }});
}})();
'''

def main():
    ap = argparse.ArgumentParser(description="create a widget plugin from the template")
    ap.add_argument("id", help="lowercase id = folder name, e.g. my-widget")
    ap.add_argument("--name", required=True)
    ap.add_argument("--needs", default="time", help="comma separated signal names")
    ap.add_argument("--category", default="life", choices=oc.CATEGORIES)
    ap.add_argument("--description", default="")
    ap.add_argument("--ja-name", default="")
    ap.add_argument("--author", default=os.environ.get("USER", "you"))
    ap.add_argument("--dir", default=os.path.join(ROOT, "widgets"))
    a = ap.parse_args()
    if not oc.ID_RE.match(a.id):
        sys.exit(f"id must match {oc.ID_RE.pattern}")
    needs = [n.strip() for n in a.needs.split(",") if n.strip()]
    bad = [n for n in needs if n not in oc.SIGNALS]
    if bad:
        sys.exit(f"unknown signals {bad}; known: {', '.join(sorted(oc.SIGNALS))}")
    folder = os.path.join(os.path.expanduser(a.dir), a.id)
    if os.path.exists(folder):
        sys.exit(f"{folder} already exists")
    desc = a.description or f"Shows {', '.join(needs)}."
    os.makedirs(folder)
    yaml = [f"id: {a.id}", f"name: \"{a.name}\"", 'version: "0.1.0"', f"author: \"{a.author}\"", "license: MIT",
            "kind: widget", f"category: {a.category}", f"description: \"{desc}\"", f"needs: [{', '.join(needs)}]",
            "default_size:", "  width: 18vw", "  height: auto", "settings:", "  title:", "    type: string",
            f"    default: \"{a.name.upper()}\"", "    description: \"Header label\""]
    if a.ja_name:
        yaml += ["i18n:", "  ja:", f"    name: \"{a.ja_name}\"", f"    description: \"{desc}\"", "    settings:",
                 "      title: \"見出し\""]
    open(os.path.join(folder, "widget.yaml"), "w").write("\n".join(yaml) + "\n")
    rows = "\n".join(f"      kv('{n.upper()}', esc(JSON.stringify(s.{n} ?? '…').slice(0, 60)))," for n in needs)
    body = ("    if (!m) return;\n    m.body.innerHTML = [\n" + rows + "\n    ].join('');\n    ctx.visible(true);")
    handlers = "\n".join(f"      {n}(data, ctx) {{ render(ctx); }}," for n in needs)
    open(os.path.join(folder, "widget.js"), "w").write(JS.format(name=a.name, description=desc, render_body=body,
                                                                handlers=handlers, title=a.name.upper(), id=a.id))
    open(os.path.join(folder, "style.css"), "w").write(f"/* {a.name}: sizes in host units, e.g. calc(var(--vh) * 1.3) */\n"
                                                      f".m-{a.id} .kv {{ grid-template-columns: 7em minmax(0, 1fr); }}\n")
    open(os.path.join(folder, "README.md"), "w").write(f"# {a.name}\n\n{desc}\n\n* needs: {', '.join('`' + n + '`' for n in needs)}\n"
                                                      "* settings: `title`\n")
    where = os.path.dirname(folder)
    ok = where in (os.path.join(ROOT, "widgets"), oc.USER_WIDGETS)
    print(f"created {folder}\nnext:  python3 tools/dev-widget.py {a.id}" +
          ("" if ok else f"\n(note: the server only loads plugins from widgets/ and {oc.USER_WIDGETS})"))

if __name__ == "__main__":
    main()
