# Modules: design (draft)

> Status: **design draft (2026-11-02).** Nothing here is implemented yet unless marked *exists*.
> It defines how Orbit grows from a handful of widgets into a set of topic modules.

## 1. What a module is

A **module** is one widget plugin (`kind: widget`) that bundles everything about **one topic**,
for example "tonight's sky" or "my Mac". It is not a list with one fact per line, and it is not a
dashboard tile per metric.

Rules for a good module:

1. **One topic and one glance.** It has a headline: the single most useful fact, such as the moon
   phase or the battery level. Below that come 2–6 supporting rows.
2. **Quiet by default.** A row that has nothing to say is hidden, not shown as `—`. A module with
   nothing to say shrinks to its headline, or hides completely if its manifest allows it
   (`hide_when_empty`). Only something that needs attention gets the accent colour, such as a
   failing CI run, an earthquake of intensity 4 or more, or a battery below 15%. Nothing blinks.
3. **Calm motion.** Values update in place. No slide-in or fade unless the event really is an
   arrival or a departure (a track change, a meeting about to start).
4. **No cramming.** A module declares a minimum width. The runtime reports a problem instead of
   squeezing text into a box that is too small.
5. **The data decides the rows.** If you're away from home, the module doesn't show the NAS
   mount rows. During the day, the sky module doesn't show the meteor-shower row.

## 2. Module catalogue

These are the modules we plan to ship. "Data" lists the signals each module declares in
`needs:`. Signals marked *new* are proposed in §3.

| module id | headline | rows (shown only when relevant) | data |
|---|---|---|---|
| `clock` *exists* | big thin time | date · meeting countdown ("in 5 min", "in a meeting") | `time`, `calendar` |
| `now-playing` *exists* | title / artist + artwork | progress; slide-in on a new track, slow fade-out when stopped | `nowPlaying` |
| `schedule` *exists* | today's timeline (horizontal) | labels with leader lines, all-day chips, NOW / NEXT | `calendar`, `time` |
| `load` (today: `system-stats`) | CPU % | memory · disk I/O · net ↓ ↑, each with a sparkline | `system` |
| `weather` *exists, extended* | current temperature + icon | hourly strip · 5-day row · UV · AQI/PM2.5 · umbrella · rain approaching | `weather` (+ `air`, `uv`, `nowcast` fields) |
| `sky` | moon phase + illumination | sunrise / sunset · planets above the horizon · ISS pass / overhead · meteor shower (tonight / in N days) | `time`, `location`, `iss` *new* |
| `mac` | battery % (or "on power") | free disk space · Time Machine (running / last backup age) · active time today | `mac` *new* |
| `home-net` | home / away | Tailscale up · NAS mounts · ping targets · line speed | `network` *new* |
| `dev` | number of items waiting for you | GitHub review requests · my PRs with failing CI · local Claude Code sessions · Claude usage | `github` *new*, `sessions` *new*, `claudeUsage` |
| `life` | next holiday | earthquakes (last 24 h, intensity ≥ 3) · exchange rate with its change | `holidays` *new*, `quakes` *new*, `fx` *new* |

Environment-specific panels are **not** built-in modules. Examples are pending RFCs in a private
repo, TLS certificate expiry, and an internal CI. They are built from a user-installed **feed**
(§4) plus a small module, or by adding a row to `dev` through a feed.

The bundled `claude-usage` widget becomes a row of `dev`. It stays as a standalone widget for
anyone who wants only that.

## 3. Signals

The rule: **one signal per data source, grouped by who produces it.** Modules may combine several
signals. A module should not need a signal it doesn't show.

| signal | producer | network? | default | sensitive |
|---|---|---|---|---|
| `time`, `system`, `audio`, `calendar`, `nowPlaying`, `location`, `weather`, `claudeUsage` | *exist* | — | as today | as today |
| `mac` | host app (IOKit power sources, `statfs`, `tmutil`, HID idle time) | no | on | no |
| `network` | host app (primary interface, Tailscale CGNAT address, SMB/NFS mounts, home-network match) + server (ping, speed test) | ping/speed only | on, except the speed test | yes (LAN names) |
| `iss` | server (wheretheiss.at, every 10 s) | yes | **off** | no |
| `github` | server, via the user's `gh` CLI | yes (GitHub) | **off** | yes |
| `sessions` | host app (`~/.claude/sessions/*.json`, live pids only, cwd basename) | no | off | yes |
| `holidays` | server (holidays-jp for `JP`, Nager.Date for other countries), daily | yes | **off** | no |
| `quakes` | server (P2PQuake JMA reports, `JP` only), 60 s | yes | **off** | no |
| `fx` | server (Frankfurter, ECB rates), hourly; pairs from config | yes | **off** | no |
| `ext.<feed>` | feed (§4) | feed-defined | off until installed | **always** |

Notes:
* **Weather is extended, not split.** Air quality (Open-Meteo air-quality API), UV
  (`uv_index`) and a 15-minute precipitation nowcast become fields of `weather`, each switched
  on by `providers.weather.air`, `.uv` and `.nowcast`. Same provider, same attribution.
* **Astronomy is computed in the module, not the host.** Moon phase, sun and planet positions,
  and the meteor-shower table (a manifest `asset`) need only `time` and `location`. The
  starfield already does this math, and we share it through the SDK (`ctx.astro`). Only the ISS
  position needs the network, so only that is a host signal.
* **The `system.ping` and `system.speed` fields stay** for compatibility, and the same data also
  appears in `network`. They can be removed in API v2.
* **Home detection is config, never hard-coded:** `providers.network.home: { ssid: "…" }` or
  `{ subnet: "10.0.1.0/24" }`. With neither set, the home/away row is hidden.
* Every network-calling provider is **off by default**, except weather (as today). Each one is
  listed in `THIRD_PARTY_NOTICES.md` with its terms.

## 4. Feeds: personal data sources

Sandboxed widgets cannot reach the network or the file system, and that must stay true.
Personal panels need data from somewhere, so we add a separate, explicitly trusted kind of
plugin.

A **feed** is a folder in `~/.config/orbit-desktop/feeds/<id>/` holding:

```yaml
# feed.yaml
id: odenops-rfc
name: Pending RFCs
version: 0.1.0
run: ["./rfc.sh"]          # argv, run from the feed folder; no shell
interval_seconds: 600
timeout_seconds: 30
max_bytes: 65536           # stdout larger than this is rejected
```

* The host runs `run` on the interval. Stdout must be a single JSON value, which is published as
  the signal `ext.odenops-rfc` to modules that list it in `needs:`.
* **Feeds are trusted code.** They run with your user account's rights, without a sandbox. They are
  therefore:
  * only loaded from your own config folder, never from `widgets/` and never bundled
  * listed with full paths in the problems panel the first time they run
  * enabled only when `layout.yaml` names them (`feeds: [odenops-rfc]`)

  This is the same trust as a LaunchAgent you write yourself. `docs/security.md` gets a section
  on it.
* Every `ext.*` signal counts as sensitive. Modules must escape the data (`ctx.esc`), as with
  every other signal.
* The repo can ship **example** feeds under `examples/feeds/`, such as GitHub-file status rows and
  TLS expiry. You copy them in yourself.

A matching generic module, `feed-list`, renders the common case ("title + rows + accent when
`alert: true`") with no code, using a small documented shape:
`{ "title": "RFC", "rows": [{ "label": "0042", "value": "waiting for you", "alert": true }] }`.

## 5. Shared look: SDK module kit

Every module should look like part of one system: a monospace HUD, thin type, quiet colours. The
SDK gains a small kit (CSS classes plus helpers), so plugin authors don't each reinvent it:

* `.o-mod` container, `.o-head` (small spaced capitals, e.g. `TONIGHT`), `.o-hero` (headline
  value), `.o-row` (label · value · optional sparkline), `.o-alert` (accent colour, no blinking)
* `ctx.row(label, value, opts)`, which returns nothing when the value is empty, so rows hide
  themselves
* `ctx.spark(values)` (exists in system-stats: move it into the SDK), `ctx.ago(ts)`, `ctx.until(ts)`
* `ctx.astro`: sun, moon and planet positions, shared with the starfield

## 6. Layout: no overlaps

Today every widget has its own anchor and offset, so two modules can overlap when their content
grows. We add **stacks**:

```yaml
stacks:
  right: { anchor: top-right, x: 3.5vw, y: 6vh, width: 25vw, gap: 2.4vh }
widgets:
  - use: load
    stack: right
  - use: mac
    stack: right
  - use: home-net
    stack: right
```

Modules in a stack flow vertically, in order. When a module hides itself, the others close up.
The runtime reports a problem if a stack runs off the screen or crosses another stack. It does
not quietly let them overlap.

## 7. Order of work

1. **SDK module kit + stacks**, then rebuild `system-stats` as `load`, and `weather` (+ air / UV /
   nowcast), on top of it. This proves the look before we multiply it.
2. **`mac` and `network`** signals in the host app (native, no subprocesses), then the `mac` and
   `home-net` modules.
3. **`sky` module**: `ctx.astro` extracted from the starfield, the meteor-shower table as an
   asset, and the `iss` provider (opt-in).
4. **Feeds** (`feed.yaml`, runner, `feed-list`), plus the security doc.
5. **`dev`** (`github`, `sessions`) and **`life`** (`holidays`, `quakes`, `fx`).
6. Port the prototype's latest visuals module by module once mac-setup's UI pass settles: schedule
   leader lines, the now-playing entrance and exit, night dimming.

## 8. Open questions

* Should night dimming (lower contrast late at night) be a theme feature (`theme.night_dim`)
  rather than per-module? It is proposed as a theme feature.
* Earthquake Early Warning (EEW) needs a push connection (WebSocket), not polling. Is it worth a
  persistent connection? It would be opt-in and JP-only, and is deferred until `quakes` exists.
* Should a feed be able to supply rows to an existing module (for example an extra row in
  `dev`), or only feed its own module? Proposal: modules may accept `extra_rows: ext.<feed>` in
  their settings.
