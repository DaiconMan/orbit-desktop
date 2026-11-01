# Configuration reference (`layout.yaml`)

Location: `~/.config/orbit-desktop/layout.yaml`. If that file is missing, the dev server falls back
to `examples/layout.yaml`. `--config PATH` overrides both.

* The desktop **reloads automatically** when the file (or any `widget.yaml`) changes.
* `providers:` are read once at server start, so restart the server after changing them.
* Problems are shown **on the desktop** in a panel at the top, and printed by the server. A broken
  widget entry is skipped and the rest still renders.

## YAML dialect

Orbit parses YAML on the host side with `host/dev-server/miniyaml.py`, a strict, safe subset. The
runtime never parses YAML, and nothing is fetched or vendored. Supported:

* block mappings and sequences (indent with spaces)
* one-line flow `[a, b]` / `{x: 1}`
* `null`/`~`, `true`/`false`, numbers, `'single'` / `"double"` quoted strings
* `#` comments

Not supported (you get a line-numbered error): anchors/aliases (`&`, `*`), tags (`!`), block
scalars (`|`, `>`), multiple documents.

> **Quote colours.** `accent: #46dcc8` is a comment in YAML, so the value becomes empty. Write
> `accent: "#46dcc8"`.

Why not vendor `js-yaml`? The validator and CI need a stdlib-only parser anyway, so one host-side
parser serves the dev server, `tools/validate.py` and CI. The browser only ever sees validated
JSON. The Swift host will use its own YAML parser restricted to the same subset.

## Top level

```yaml
version: 1          # optional, must be 1
theme: {...}
background: {...}
widgets: [...]
providers: {...}
```

## `theme`

| key | default | notes |
|---|---|---|
| `font` | `-apple-system, "SF Pro Display", "Hiragino Sans", sans-serif` | CSS font-family list. **Local fonts only**, because frames cannot load web fonts. |
| `mono_font` | `ui-monospace, "SF Mono", Menlo, monospace` | |
| `accent` | `auto` | `auto` derives a 3-colour palette from the current album artwork. A colour fixes the main accent (`--c`). |
| `text_color` | `#ffffff` | |
| `locale` | `auto` | BCP-47 tag (`ja-JP`, `en-GB`, …). `auto` uses the system language. Widgets ship en + ja strings. |
| `hour12` | `false` | |

Plugins receive the theme as CSS variables: `--font`, `--mono`, `--fg`, `--a`/`--b`/`--c`
(`r,g,b` triplets, use `rgb(var(--c))`), and `--vh` / `--vw`, the host screen's units.

## `background`

```yaml
background:
  use: starfield            # a background plugin, or a built-in below
  settings: {...}           # validated against the plugin's settings schema
  react:                    # plugin backgrounds only: source -> hook or [hooks]
    cpu: [twinkle, meteors]
    audio.bass: glow
```

### Built-in backgrounds (no code, rendered by the trusted runtime)

| use | settings |
|---|---|
| `color` | `color` |
| `gradient` | `stops` (list of ≥ 2 colours), `angle` (deg), `style` (`linear` / `radial`) |
| `image` | `path` (local file: jpg/png/webp/gif/heic), `fit` (`cover`/`contain`/`fill`), `opacity`, `blur` (px), `color` |
| `video` | `path` (local file: mp4/m4v/mov/webm), `fit`, `opacity`, `playback_rate`, `color`. Always muted and looped. |

The server serves only that one file, at `/media/background`.

### Reactions (`react:`)

**Sources** are computed by the SDK, normalised to 0..1 and smoothed:

| source | meaning |
|---|---|
| `cpu` | CPU load (`cpu% × 1.3`, clamped) |
| `net` | network throughput, log scale (≈10 KB/s → 0, ≈50 MB/s → 1) |
| `audio.level`, `audio.bass`, `audio.mid`, `audio.high` | auto-gained system-audio energy. Zero while music is not playing if the plugin also needs `nowPlaying`. |

**Hooks** are named by each background plugin in its manifest (`reactions.hooks`). If you give
`react:`, it *replaces* the plugin's `reactions.default`. When several sources feed one hook, the
hook gets their maximum. The starfield supports:

| hook | effect | default |
|---|---|---|
| `twinkle` | star twinkle strength & speed | `cpu` |
| `meteors` | shooting-star rate | `cpu` |
| `heat` | warm glow from the bottom, pulsing edges above 0.7 | `cpu` |
| `streamlines` | count / speed / length of the flowing light trails | `net` |
| `glow` | Milky Way brightness + bright-star flare | `audio.bass` |

Example "music visualiser" mapping:
`react: { audio.bass: [glow, twinkle], audio.high: meteors, net: streamlines }`

## `widgets`

```yaml
widgets:
  - use: clock                      # plugin id
    position:
      anchor: bottom-left           # top-left | top-center | top-right | center-left | center |
                                    # center-right | bottom-left | bottom-center | bottom-right
      x: 6vw                        # offset from the anchored edge (number = px, or px/vh/vw/%/rem/em)
      y: 11vh
      width: auto                   # auto = size to content (default from the manifest's default_size)
      height: auto
      z: 0                          # stacking among widgets (-10..100)
    settings:
      show_date: true
```

A bare anchor is also accepted: `position: top-right`. For `*-center` / `center`, the offsets
shift the widget from the centre.

## `providers`

| block | keys (defaults) |
|---|---|
| `location` | `mode: fixed` (`fixed` / `corelocation` / `ip`), `lat`, `lon`, `name`, `corelocation_cli: /opt/homebrew/bin/CoreLocationCLI` |
| `weather` | `enabled: true`, `refresh_minutes: 15` |
| `system` | `interface: auto` |
| `ping` | `targets: []` (each `{name, host, method: icmp\|tcp, port: 22}`), `interval_seconds: 10`, `external_file: null` (JSON from `host/helpers/tcp-latency.sh`) |
| `speedtest` | `enabled: false`, `interval_minutes: 60`, `only_on_ac_power: true` |
| `now_playing` | `enabled: true`, `players: [music, spotify]`, `itunes_artwork_fallback: false`, `itunes_country: US` |
| `calendar` | `file: ~/Library/Caches/orbit-desktop/calendar.json` |
| `audio` | `file: ~/Library/Caches/orbit-desktop/audiopulse.json` |
| `claude_usage` | `enabled: false`. **UNOFFICIAL**: reads an undocumented field of `~/.claude.json`. |

`docs/security.md` lists every outbound request and which setting turns it on.
