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
zones: {...}        # optional: areas where widgets flow without overlapping (and rotating pages)
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
| `night_dim` | `false` | From 00:00 to 06:00, every widget settles to about 65 % opacity, except widgets with `dim: false`. |

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

Other widget keys:
* `dim: false` exempts a widget from night dimming. While an earthquake or tsunami alert is
  shown, the other widgets fade to 18 %; this widget does not.
* `zone`, `page` and `column` place the widget in a zone (see below). With `zone`, `position` is
  ignored.

## `zones`

A zone is an area where widgets stack vertically in list order. When a widget hides itself (it
has nothing to show) or grows, the others move up or down, so they never overlap. A zone with
`rotate_seconds` holds **pages** of `columns` columns that crossfade.

```yaml
zones:
  tl: { anchor: top-left,  x: 6vw, y: 6vh, width: 21vw }
  tr: { anchor: top-right, x: 6vw, y: 6vh, width: 25vw, gap: 3.4vh }
  c:  { anchor: top-left, x: 30.5vw, y: 6vh, width: 35vw, height: 41vh, columns: 2, column_gap: 3vw, rotate_seconds: 30 }
widgets:
  - { use: weather, zone: tl }
  - { use: load, zone: tr }
  - { use: tonight, zone: c, page: 0, column: 0 }
  - { use: sky, zone: c, page: 0, column: 1 }
```

| key | default | notes |
|---|---|---|
| `anchor`, `x`, `y` | `top-left`, 0, 0 | same as a widget position |
| `width` | `20vw` | widgets in the zone get this width, or the column width |
| `height` | `auto` | needed for a paged zone (default 40vh) |
| `gap` | `3.4vh` | vertical gap between widgets |
| `columns`, `column_gap` | 1, `3vw` | columns per page |
| `rotate_seconds` | none | makes the zone paged; pages with nothing visible are skipped |

`?page=N` in the page URL starts every paged zone on page N, which is handy for screenshots.

## `settings.json` (written by the host app)

The host app's settings window writes `~/.config/orbit-desktop/settings.json`. The server applies
it on top of `layout.yaml`:
* `wallpaper.hidden`: plugin ids to leave out
* `wallpaper.page_seconds`: replaces every zone's `rotate_seconds`
* `eew`: Earthquake Early Warning options, used only by the host app
* `providers`: `{"<name>": {"enabled": bool}}`, the data-source switches of the editor; they are merged
  over layout.yaml's `providers` (the app restarts the server when one changes)
* `theme.night_dim`: the editor's 夜は少し暗くする switch
* `acknowledged`: warnings marked 確認済み (they are no longer shown in the corner notice)
* `arrangement`: what the **layout editor** (menu → レイアウトを編集…) saved, i.e. `zones` and `widgets` in the
  same format as in `layout.yaml`. When present, they replace layout.yaml's `zones` and `widgets`. Theme,
  background and providers still come from layout.yaml. 「初期配置に戻す」 deletes it.

```json
{ "wallpaper": { "hidden": ["news"], "page_seconds": 30 },
  "eew": { "enabled": true, "notify": true, "pause_music": true, "min_intensity": null, "pause_min_intensity": "5弱" } }
```

## `providers`

| block | keys (defaults) |
|---|---|
| `location` | `mode: fixed` (`fixed` / `corelocation` / `ip`), `lat`, `lon`, `name`, `corelocation_cli: /opt/homebrew/bin/CoreLocationCLI` |
| `weather` | `enabled: true`, `refresh_minutes: 15`, `air: true` (Open-Meteo air quality), `pressure: true` (surface pressure, past 12 h + next 24 h) |
| `system` | `interface: auto` |
| `ping` | `targets: []` (each `{name, host, method: icmp\|tcp, port: 22}`), `interval_seconds: 10`, `external_file: null` (JSON from `host/helpers/tcp-latency.sh`) |
| `speedtest` | `enabled: false`, `interval_minutes: 60`, `only_on_ac_power: true` |
| `now_playing` | `enabled: true`, `players: [music, spotify]`, `itunes_artwork_fallback: false`, `itunes_country: US` |
| `calendar` | `file: ~/Library/Caches/orbit-desktop/calendar.json` |
| `audio` | `file: ~/Library/Caches/orbit-desktop/audiopulse.json` |
| `claude_usage` | `enabled: false`. **UNOFFICIAL**: reads an undocumented field of `~/.claude.json`. |
| `mac` | `enabled: true`, `active: true` (count minutes with keyboard/mouse input today) |
| `network` | `enabled: true`, `home_subnet: null` (e.g. `"192.168.1.0/24"`), `home_ssid: null`, `home_interface: auto`, `mounts: []` (SMB share names, e.g. `[Share, Media]`), `interval_seconds: 5` |
| `recent` | `enabled: true`, `max_items: 8` (local history of `nowPlaying`, kept in the cache folder) |
| `iss` | `enabled: false` |
| `quakes` | `enabled: false`, `min_intensity: "3"` (JMA shindo `1`…`7`, quote `"5弱"`), `hours: 24` |
| `holidays` | `enabled: false`, `country: JP` (only JP for now) |
| `fx` | `enabled: false`, `base: USD`, `quote: JPY` |
| `news` | `enabled: false`, `url: https://www.nhk.or.jp/rss/news/cat0.xml` (any https RSS 2.0 / Atom feed), `max_items: 8` |
| `bluetooth` | `enabled: false` (connected devices + battery, via `system_profiler` every 5 min) |
| `onthisday` | `enabled: false`, `lang: ja` (`ja` parses the ja.wikipedia day article; other codes use the Wikimedia feed) |
| `launches` | `enabled: false` (The Space Devs, cached 3 h) |
| `kp` | `enabled: false` (NOAA SWPC) |
| `github` | `enabled: false`, `gh_path: gh` (looked up in `PATH`, then `/opt/homebrew/bin`, `/usr/local/bin`). Also used by `contrib` and `rfc`. Needs `gh auth login`. |
| `contrib` | `enabled: false` (your contribution calendar, via `gh`) |
| `sessions` | `enabled: false` (running Claude Code sessions: folder basename and kind only) |
| `rfc` | `enabled: false`, `repo: null` (owner/name, required), `dir: rfc`, `file_prefix: "RFC-"`, `status_label: Status`, `pending_text: "Pending approval"`, `user_action_text: null`. Lists the newest 25 `<file_prefix>*.md` files whose table row `\| <status_label> \| … \|` contains `pending_text`; `user_action` is true when it also contains `user_action_text`. |

Privacy-first defaults: only `mac`, `network` (local commands only) and `recent` are on. Every
provider that calls the network or shows personal data is off until you enable it, and nothing
personal (hosts, subnets, shares, repos) has a built-in default. Enabling `github`, `contrib`,
`rfc` or `sessions` adds a start-up warning. `network.home` is `null` (unknown) unless
`home_subnet` or `home_ssid` is set. LAN latency: add the host to `ping.targets` with
`method: tcp`; under the host app the server connects directly (the old `external_file` helper is
only needed if macOS Local Network privacy blocks it).

`docs/security.md` lists every outbound request and which setting turns it on.
