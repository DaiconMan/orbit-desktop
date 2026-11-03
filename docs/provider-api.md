# Provider API (v1)

> The canonical, machine-readable payload contracts are the JSON Schemas in
> [`schemas/signals/`](../schemas/signals/) (index: `schemas/signals/index.json`), with samples in
> [`examples/mock/`](../examples/mock/). This page explains the transport and the main signals.

The contract between a **host** and the **runtime page**. The host is the Python dev server
(`host/dev-server/orbit_server.py`). It runs either on its own or as a child process of the Swift
host app (`host/app`). In the second case, it gets these arguments:
* `--host-dir DIR`: the app measures the `system` fields `cpu`, `load`, `mem`, `disk` and
  `net`, plus the `audio` and `calendar` signals, natively. It writes them to
  `DIR/system.json`, `DIR/audio.json` and `DIR/calendar.json`, in the formats below. The server
  serves those files instead of running its own loops.
* `--parent-pid PID`: the server exits when the app is gone.

The responses are the same either way, so the runtime and every plugin work unchanged.

Plugins never call this API. Only the trusted runtime page does, and it forwards data to plugin
frames over `postMessage` (see [Runtime ↔ plugin messages](#runtime--plugin-messages)).

## Transport rules (all endpoints)

* Base URL: `http://127.0.0.1:<port>/` (dev default `47900`). Hosts **must** bind loopback only.
* Hosts **must** reject a request whose `Host` header is not `127.0.0.1:<port>` or
  `localhost:<port>` (403), and any `/api/*` request whose `Origin` header is present and not one
  of those origins (403).
* Only `GET` is allowed. Every other method returns 405.
* Responses carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
* JSON is UTF-8. A missing value is `null`, not an absent key, unless the key is noted as optional.
* A disabled provider returns **404**. The runtime treats that as "no data".

## Pages & plugin delivery

| method & path | response |
|---|---|
| `GET /` | runtime page (`runtime/index.html`) with the host-page CSP |
| `GET /runtime/host.js`, `/runtime/host.css` | runtime assets |
| `GET /frame/<pluginId>` | sandboxed plugin document: SDK CSS + plugin `style.css` + SDK JS + `widget.js` inlined with a per-response nonce, sent with the frame CSP (see `security.md`). 404 unless it is an installed widget (the layout editor previews widgets before they are added) or the active background. |
| `GET /plugins/<pluginId>/assets/<path>` | a data asset listed in the plugin manifest's `assets:` (JSON/text). 404 otherwise. |
| `GET /media/background` | the local file of a built-in `image`/`video` background. Supports `Range` (206/416). |

## Config

### `GET /api/config`
The resolved, validated layout. Invalid widgets are dropped, and the reasons appear in `errors`.

```json
{
  "version": "3fa9c1",
  "configPath": "/Users/me/.config/orbit-desktop/layout.yaml",
  "theme": { "font": "...", "mono_font": "...", "accent": "auto", "text_color": "#ffffff", "locale": "auto", "hour12": false },
  "background": {
    "use": "starfield", "builtin": false, "name": "Starfield",
    "needs": ["system", "audio", "nowPlaying", "location"],
    "settings": { "fps": 30, "...": "..." },
    "react": { "cpu": ["twinkle", "meteors", "heat"], "net": ["streamlines"], "audio.bass": ["glow"] },
    "hooks": ["glow", "heat", "meteors", "streamlines", "twinkle"],
    "assets": ["data/stars.6.json"], "unofficial": false
  },
  "widgets": [
    { "instance": "w0", "use": "clock", "name": "Clock", "needs": ["time"],
      "settings": { "show_date": true, "seconds": false, "size": 15 },
      "position": { "anchor": "bottom-left", "x": "6vw", "y": "11vh", "width": "auto", "height": "auto", "z": 0 },
      "assets": [] }
  ],
  "providers": { "weather": true, "nowPlaying": true, "claudeUsage": false, "speedtest": false, "pingTargets": ["NAS"] },
  "errors": ["widgets[2].settings (clock).show_date: expected boolean, got 'yes'"],
  "warnings": []
}
```

### `GET /api/config/version` → `{"version": "3fa9c1"}`
This changes whenever `layout.yaml` or any `widget.yaml` changes. The runtime polls it every 5 s
and reloads when it changes.

### `GET /api/health` → `{"ok": true, "api": 1, "server": "orbit-dev-server", "time": 1700000000.0, "hostApp": false}`
`hostApp` is `true` when the server runs under the Swift host app (`--host-dir`).

## Signals

Each signal name below matches the name plugins use in `needs:`.

### `system` → `GET /api/signals/system` (runtime polls every 2 s)
```json
{ "cpu": 23.5, "load": 3.1,
  "mem": { "used": 12478480384, "total": 17179869184, "pct": 72.6 },
  "disk": { "mbs": 17.9 },
  "net": { "rx": 2333208.0, "tx": 45327.3, "iface": "en0" },
  "ping": { "NAS": 3.2, "ROUTER": null },
  "speed": { "dl": 870.1, "ul": 410.5, "at": 1700000000.0 },
  "ts": 1700000000.0 }
```
* `cpu` is a percentage of total machine capacity (0–100).
* `net` is bytes per second on the default-route interface.
* `ping` values are in ms, with `null` meaning unreachable.
* `speed` is in Mbps, or `null` if no speed test has run yet.
* Any field may be `null` during warm-up.

### `nowPlaying` → `GET /api/signals/now-playing` (2 s) and `GET /api/signals/artwork`
```json
{ "state": "playing", "source": "music", "key": "b45c2f0bc343", "title": "…", "artist": "…", "album": "…",
  "position": 152.3, "duration": 189.8, "hasArt": true, "ts": 1700000000.0 }
```
* `state` is one of `playing`, `paused` or `stopped`.
* `source` is `music` or `spotify`.
* `key` changes whenever the track changes.
* `/api/signals/artwork` returns the raw artwork bytes (`image/jpeg` or `image/png`) for the
  current `key`, or 404.

The runtime adds `artwork` (a `data:image/jpeg` URL, max 600 px, or `null`) and `recv` (when it
received the poll, in ms) before forwarding.

### `calendar` → `GET /api/signals/calendar` (30 s)
```json
{ "events": [ { "title": "Standup", "start": "2026-11-02T00:00:00Z", "end": "2026-11-02T00:15:00Z", "allDay": false,
                "calendar": "Work", "color": "#1badf8", "location": "", "status": "busy" } ],
  "ts": 1700000000.0 }
```
This covers today and the next 8 days (the host app's EventKit provider). `status` is `busy` or `free`.

### `weather` → `GET /api/signals/weather` (60 s; the host refreshes upstream every `refresh_minutes`)
This is the Open-Meteo forecast: `current`, `hourly` (12 h), `daily` (5 d, incl. `sunrise`, `sunset`,
`uv_index_max`), `minutely_15` (`precipitation`, next 2 h), their `*_units`, `timezone`,
`timezone_abbreviation`, `utc_offset_seconds` and `elevation`, plus the fields below. Coordinates are
deliberately absent.
```json
{ "place": "GREENWICH · LONDON", "place_src": "config", "fetched": 1700000000.0,
  "attribution": "Weather data by Open-Meteo.com (CC BY 4.0)",
  "air": { "pm25": 12.3, "aqi": 41, "at": 1700000000.0 },
  "pressure": { "time": ["2026-11-02T13:00", "…"], "hpa": [1012.4, "…"], "at": 1700000000.0 } }
```
`air` (`providers.weather.air`) and `pressure` (`providers.weather.pressure`, hourly, past 12 h + next
24 h) are `null` when disabled or not fetched yet.

### `location` → `GET /api/signals/location` (60 s)
`{"lat": 51.4779, "lon": -0.0015, "name": "GREENWICH · LONDON", "source": "config" | "corelocation" | "ip"}`

### `audio` → `GET /api/stream/audio` (Server-Sent Events) / `GET /api/signals/audio` (snapshot)
Each SSE `data:` line is one frame, about 20 per second:
```json
{ "level": 0.031, "bass": 0.012, "mid": 0.004, "high": 0.0009, "bands": [16 numbers, 40 Hz – 12 kHz log-spaced], "ts": 1700000000.123 }
```
Values are raw, not normalised. The SDK applies auto-gain. The server sends a `: ping` comment
every 15 s and allows at most 8 concurrent streams (503 beyond that).

### `time` (generated by the runtime, 1 Hz)
`{"now": 1700000000000, "locale": "ja-JP", "hour12": false, "tz": "Asia/Tokyo"}`

### `claudeUsage` → `GET /api/signals/claude-usage` (30 s): UNOFFICIAL, opt-in
`{"rows": [{"key": "five_hour", "pct": 42.0, "resets": "2026-11-02T05:00:00Z"}], "fetched": 1700000000.0}`

Returns 404 unless `providers.claude_usage.enabled: true`.

### Panel signals (generic, `GET /api/signals/<name>`)
Served from `orbit_config.GENERIC_SIGNALS`; each returns 404 while its `providers.<name>.enabled` is
false, and `null` until the first fetch. Times are Unix seconds unless noted.

| signal (poll) | payload |
|---|---|
| `mac` (30 s) | `{ac, batt, batt_state, batt_left: "h:mm"\|null, tm_running, tm_pct\|null, tm_last, disk_total, disk_free, active: {date, minutes, idle}\|null}` (keys may be absent on desktops without a battery / Time Machine) |
| `network` (5 s) | `{home: {home: bool\|null, ip}, tailscale: {up, ip}, mounts: {<share>: bool}, ping: {<name>: ms\|null}, speed: {dl, ul, at}\|null}` |
| `alerts` (1 s) | `{eew, tsunami, ws, pref, eewEnabled}`, written by the host app (`host_dir/alerts.json`) |
| `iss` (10 s) | `{lat, lon, alt, vis, ts}` |
| `quakes` (60 s) | `[{ts, scale, place, mag\|null}]`, newest first; `scale` is the P2PQuake code (30 = shindo 3, 45 = 5弱 …) |
| `holidays` (1 h) | `{upcoming: [{date, name}] (next 5), map: {"YYYY-MM-DD": name}}` |
| `fx` (30 min) | `{rate, prev, date, at, base, quote}`; `prev` is the last different rate (persisted) |
| `news` (10 min) | `{items: [{title, at\|null}], at}` |
| `bluetooth` (2 min) | `{devices: [{name, type, battery: {main?, L?, R?, case?}}], at}` |
| `onthisday` (10 min) | `{date, events: [{year, text}], observances: [text]}` |
| `launches` (30 min) | `{items: [{name, net (ISO), status, provider, location}], at}` |
| `kp` (30 min) | `{rows: [["YYYY-MM-DDTHH:MM:SS", kp]] (last 24), at}` |
| `recent` (10 s) | `{items: [{title, artist, source, at}]}` |
| `contrib` (30 min) | `{days: [["YYYY-MM-DD", count]] (last 14 weeks), year, at}` |
| `github` (5 min) | `{review, review_items: [{title, repo}], mine: [{title, repo, ci}], failing, at}`; `ci` is the GitHub rollup state or `null` |
| `sessions` (15 s) | `{local: [{cwd (basename), kind}]}` |
| `rfc` (10 min) | `{pending: [{id, name, user_action}], at}` |

## Runtime ↔ plugin messages

All messages are objects with `orbit: 1` and a `type`. The runtime accepts messages only from the
`contentWindow` of a frame it created, and only with origin `"null"` (sandboxed). The SDK accepts
messages only from `window.parent`.

| direction | `type` | payload |
|---|---|---|
| plugin → host | `ready` | none (sent once the SDK loads) |
| host → plugin | `init` | see below |
| host → plugin | `signal` | `name` (one of the plugin's `needs`), `data` |
| host → plugin | `theme` | `theme`, `viewport` (palette change, screen resize) |
| plugin → host | `size` | `w`, `h`, CSS px of the content, for auto-sized widgets (clamped to the screen) |
| plugin → host | `error` | `message` (≤ 400 chars), shown in the on-screen problems panel |

The `init` message carries:
* `settings`
* `theme`, including `palette: {a, b, c}` as `"r,g,b"` strings
* `viewport: {w, h}`
* `assets`, a map from path to parsed JSON or text
* `needs`
* `sizing: {width, height}` (widgets)
* `maxWidth` (widgets)
* `react` and `hooks` (backgrounds)

## Versioning
`/api/health.api` is the API major version. Adding fields or signals is non-breaking. Removing or
renaming them bumps the major version.
