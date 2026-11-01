# Orbit Desktop

**A live, pluggable desktop for macOS.** The real night sky over your city as your wallpaper,
reacting to your Mac: stars twinkle harder and meteors fall when the CPU is busy, light trails
stream with network traffic, the Milky Way pulses with the bass of the music you're playing.
On top sit widgets for time, weather, system stats, now playing, today's schedule, and more.

Everything is a plugin, configured in one YAML file, and every plugin runs in a **sandboxed,
network-less frame**, so community widgets can't phone home with your calendar.

> Status: **developer preview.** A small Swift menu-bar app (`host/app`) shows the page on the
> desktop and measures system stats, audio and calendar natively. It runs the Python dev server
> as a child process. You can still use the dev server alone with
> [Plash](https://github.com/sindresorhus/Plash).

<!-- Screenshots: docs/images/desktop.png, docs/images/demo.gif (to be added) -->
_Screenshots coming soon._

## Features
* **Starfield background**:
  * real stars (magnitude ≤ 6) placed for your location and time
  * the Milky Way, planets and the Moon with its current phase, Sgr A*
  * meteors, network streamlines, an occasional UFO
* **Widgets**: `clock`, `weather` (Open-Meteo), `system-stats` (sparklines, ping, speed test),
  `now-playing` (Apple Music / Spotify, with the accent colour taken from the artwork),
  `schedule` (calendar gantt), and `claude-usage` (unofficial, opt-in).
* **Config-only backgrounds**: `color`, `gradient`, `image`, `video` (local file).
* **Reactions**: map signals to background effects in YAML, e.g. `react: { audio.bass: glow, cpu: meteors }`.
* **Plugin sandbox**:
  * opaque-origin iframes with `default-src 'none'`
  * data passed only by `postMessage`, and only the signals a plugin declares in `needs:`
  * see [docs/security.md](docs/security.md)
* **Friendly errors**: config mistakes appear on the desktop with the exact key and fix. Save
  the file and the desktop reloads.

## Quick start (host app)

Requirements: macOS 14+ (14.2+ for audio reactions) and the Xcode Command Line Tools
(`xcode-select --install`).

```sh
git clone <this repo> ~/src/orbit-desktop && cd ~/src/orbit-desktop
host/app/build.sh --install      # builds "Orbit Desktop.app" into ~/Applications and starts it
```

Then use the ✦ menu-bar icon and choose **Edit layout.yaml…** to set `providers.location` to your
city. macOS asks for the Calendar and System Audio Recording permissions the first time a widget
needs them. Details, including how to keep permissions across rebuilds, are in
[host/app/README.md](host/app/README.md).

## Quick start (dev server + Plash)

Requirements: macOS 14+, Python 3.9+ (the system `python3` works; 3.13 is tested), and
[Plash](https://sindresorhus.com/plash) from the Mac App Store.

```sh
git clone <this repo> ~/src/orbit-desktop && cd ~/src/orbit-desktop
python3 tools/validate.py                         # sanity check: prints OK
mkdir -p ~/.config/orbit-desktop
cp examples/layout.yaml ~/.config/orbit-desktop/layout.yaml
$EDITOR ~/.config/orbit-desktop/layout.yaml       # set providers.location to your city
python3 host/dev-server/orbit_server.py           # http://127.0.0.1:47900/
```

1. Open `http://127.0.0.1:47900/?demo` in Safari to preview. `?demo` fakes load, network, audio
   and a playing track.
2. In Plash, choose **Add Website** and enter `http://127.0.0.1:47900/`.
3. Optional data sources, documented in [host/helpers](host/helpers/README.md):
   * `audiopulse`: the system-audio spectrum for music reactions
   * `calpulse`: calendar events for the schedule widget
   * `tcp-latency.sh`: LAN latency

The first time Apple Music or Spotify is queried, macOS asks for Automation permission.

## Configuration
One file: `~/.config/orbit-desktop/layout.yaml`. Start from
[`examples/layout.yaml`](examples/layout.yaml). The full reference is in
[docs/configuration.md](docs/configuration.md):
* theme fonts, colours and locale
* backgrounds and `react:` hooks
* widget anchors, offsets and sizes
* providers: location, ping targets, speed test, …

```yaml
theme: { accent: auto, locale: auto }
background: { use: starfield, react: { cpu: [twinkle, meteors], audio.bass: glow } }
widgets:
  - use: clock
    position: { anchor: bottom-left, x: 6vw, y: 11vh }
```

## Writing widgets & backgrounds
A plugin is a folder holding `widget.yaml`, `widget.js`, an optional `style.css` and a
`README.md`, with no build step. See [CONTRIBUTING.md](CONTRIBUTING.md) for the manifest
reference, the SDK, examples and the PR review checklist.

## Architecture

```
layout.yaml ──► Orbit Desktop.app (Swift): desktop windows, native system / audio / calendar
                 └─ child: dev server (Python)
                      ├─ validates config + manifests (stdlib YAML subset)
                      ├─ providers: now playing · weather · location · ping · …
                      └─ Provider API (HTTP + SSE on 127.0.0.1)  ── docs/provider-api.md
                          ▼
                 runtime page (trusted) ── postMessage (only declared `needs`) ──► plugin iframes
                                                                                    (sandbox, CSP: no network)
```

## Roadmap
* **Phase 1 (this):** plugin architecture, sandbox, YAML config, Python dev server, Plash.
* **Phase 2 – Swift host app** (`host/app`, in progress):
  * done: desktop-level windows with WKWebView, a menu-bar item, a child-process server
  * done: native system stats, a Core Audio tap and EventKit
  * done: a `WKContentRuleList` blocking all non-loopback loads, and WebRTC switched off
  * next: CoreLocation, now playing, a 20 fps background budget, a layout UI
* **Phase 3 – distribution:** a Homebrew cask, then a signed and notarized build (Developer ID).
  Auto-update after that.
* Later: a plugin gallery, per-plugin permission prompts for sensitive signals, multi-display
  layouts.

## License
MIT © DaiconMan. Third-party data and services are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The star catalogue is BSD-3-Clause (d3-celestial). Weather data is © Open-Meteo, CC BY 4.0.
