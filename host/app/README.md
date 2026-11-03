# Orbit Desktop.app (Swift host)

A small menu-bar app that puts the Orbit runtime on your desktop and owns every macOS
permission. It replaces Plash and the separate helpers.

* **Desktop windows**: one borderless, non-activating panel per screen at desktop level (below the
  Finder icons), on every Space, each showing a `WKWebView` of the runtime page. They are
  click-through except over clickable widgets (see "Messages from the page" below).
* **Server**: it starts `host/dev-server/orbit_server.py` as a child process, restarts it if it
  crashes, and the server exits by itself if the app goes away (`--parent-pid`).
* **Native providers**: the app measures these itself and drops them as JSON into
  `~/Library/Caches/orbit-desktop/host/`, which the server reads (`--host-dir`):

  | signal | how | permission |
  |---|---|---|
  | `system` cpu / load / mem / disk / net | Mach `host_statistics`, `sysctl NET_RT_IFLIST2`, IOKit block-storage stats, every 2 s. No `ps`, `vm_stat`, `netstat` or `iostat` processes. | none |
  | `audio` | Core Audio process tap (macOS 14.2+). It follows output-device changes, and writes once a second during silence. | System Audio Recording Only |
  | `calendar` | EventKit, start of today to +8 days, every 5 min and on changes | Calendars (full access) |
  | `alerts` | Earthquake Early Warning / tsunami, see below | Notifications (optional), Automation (to pause music) |

  The audio and calendar providers start only when the active layout uses a plugin that
  `needs:` them, so you never get a prompt for a widget you don't use. Now playing still comes
  from the server's AppleScript calls. Because the server is the app's child process, the
  Automation prompt also names Orbit Desktop.
* **Earthquake Early Warning (緊急地震速報)**: always on unless disabled in the settings. The app
  keeps a WebSocket open to the P2P地震情報 stream (`wss://api.p2pquake.net/v2/ws`, codes 556 EEW
  and 552 tsunami). It reconnects with jittered backoff (2 s → 5 min), pings after 60 s of
  silence and reconnects if the stream says nothing for 3 min. While a warning is active it:
  * writes `alerts.json` to the host dir (on every change, and once a second while active) for
    the wallpaper's alert overlay. Field names match the prototype (`eew`, `tsunami`, `ws`, `pref`, `ts`).
  * shows a red, click-through banner along the bottom of every screen, above full-screen apps
    (orange when an EEW is cancelled)
  * posts one notification per event and plays the Sosumi sound itself, so you hear it even
    when notifications aren't allowed. Permission is asked on the first warning.
  * pauses Music / Spotify once per event, but only players that are already running and
    playing. It does this when your prefecture is among the warned areas, or when the forecast
    maximum intensity is at least `pause_min_intensity`. Your prefecture comes from the
    `location` signal through the GSI reverse geocoder, refreshed every 30 min. If that fails,
    it falls back to 東京都・神奈川県.

  An EEW shows for 3 min after its last update, or 15 s after it is cancelled. A tsunami
  warning shows for 12 h (10 min for a test). Messages from the stream marked `test` are
  ignored unless `~/Library/Caches/orbit-desktop/eew-accept-test` exists. Menu ›
  "緊急地震速報のテスト表示" writes a sample to `~/Library/Caches/orbit-desktop/eew-test.json`.
  The app injects any such file that is less than 60 s old. Music pausing is a dry run for
  tests unless the JSON has `"_pause": true`.
* **Hardening** on top of the frame CSP (see [docs/security.md](../../docs/security.md)):
  * a `WKContentRuleList` blocks every load that isn't `http://127.0.0.1:<port>/`, `data:`,
    `blob:` or `about:`
  * a navigation delegate cancels every navigation to another origin, in any frame
  * WebRTC is switched off
  * the website data store is non-persistent

## Build and run

Requirements: macOS 14+ (14.2+ for audio) and the Xcode Command Line Tools (Swift 6 and
`/usr/bin/python3`). Full Xcode isn't needed.

```sh
host/app/build.sh              # -> host/app/build/Orbit Desktop.app
host/app/build.sh --install    # copy it to ~/Applications and launch it
```

If you used Plash before, remove the Orbit page from Plash, or quit Plash.

The ✦ menu-bar icon offers everything as GUI, with no file editing:
* The first lines show the server and EEW connection status.
* **レイアウトを編集…** (⌘E): the customise mode on the desktop itself (library, inspector, bottom bar):
  arrangement, shown modules, providers, night dimming and page rotation. Changes go to `settings.json`;
  `layout.yaml` is never rewritten.
* **設定…** (⌘,): 全般 (ログイン時に起動) and 緊急地震速報.
* **確認事項…**: config errors, warnings and widget errors, with the number of open items in the
  title. 確認済みにする adds the current warnings and widget errors to `acknowledged`.
* **壁紙を再読み込み** (⌘R) and **緊急地震速報のテスト表示**.
* **詳細**: edit `layout.yaml` as text (in a text editor, not Xcode), browser preview,
  server log (`~/Library/Logs/OrbitDesktop/server.log`), and restart the server.
* **ログイン時に起動**.

### Messages from the page
The runtime page posts `window.webkit.messageHandlers.orbit.postMessage(msg)`. The app accepts them only
from the main frame at `http://127.0.0.1:<port>`; plugin frames can't reach it directly.

| `type` | effect |
|---|---|
| `saveArrangement` | writes `arrangement` (null removes it), `hidden` → `wallpaper.hidden`, `providers` → `providers.<name>.enabled`, `theme.night_dim`, `pageSeconds` → `wallpaper.page_seconds` (all optional), then leaves edit mode. If a provider was switched on or off, the server restarts. |
| `ackWarnings` | adds `warnings` to `acknowledged` (sorted, at most 200) |
| `clickZones` | `zones: [{x, y, w, h}]` in CSS px of that window's page. While not editing, the app polls the pointer 20×/s (only while some window has zones) and takes the mouse only while it is over a zone. Clicks reach the page with one click, without activating the app or taking focus. |
| `runAction` | `action: {type, value}`: `url` (http, https, mailto, x-apple.systempreferences, shortcuts, raycast, or a scheme of an installed app; never file/javascript), `app` (bundle id or app name, localized names too), `shortcut` (`/usr/bin/shortcuts run <name>`), `script` (an executable file inside your home folder, no shell, no arguments, 120 s timeout, output in the system log), `music` (`playpause`, `next`, `previous`, `shuffle`, `repeat`, `playlist:<name>`; Spotify takes `playlist:spotify:…` URIs) for whichever of Music / Spotify is playing, else running. Failures beep and are logged. |
| `pluginError` | collected for 確認事項 |
| `exitEdit` | leaves edit mode |

If Finder shows desktop icons, its icon layer sits above the wallpaper and may take clicks on the
empty desktop before they reach a widget.

### Keeping permissions across rebuilds
`build.sh` signs with a local identity named "Orbit Desktop Dev" when one exists. Create it once with
`host/app/make-signing-cert.sh` (no Keychain Access, no trust settings needed). Only its hash goes into the
designated requirement, so calendar, audio and notification permissions survive rebuilds. Without it the
build is ad-hoc signed, and the permissions reset after every rebuild.

### settings.json (`~/.config/orbit-desktop/settings.json`)
The 設定 window (EEW) and the on-desktop editor edit it. It is created on the first save, and unknown keys are kept. The
first time the app starts, it copies the `eew` and `wallpaper` sections from the prototype's
`~/.config/nowplaying-wallpaper/config.json`, if that file exists.
```json
{"eew": {"enabled": true, "notify": true, "pause_music": true, "min_intensity": null, "pause_min_intensity": "5弱"},
 "wallpaper": {"hidden": ["weather"], "page_seconds": 30},
 "providers": {"speedtest": {"enabled": false}}, "theme": {"night_dim": true},
 "arrangement": {"zones": {}, "widgets": []}, "acknowledged": ["…"]}
```
`min_intensity` / `pause_min_intensity` are 1, 2, 3, 4, 5弱, 5強, 6弱, 6強 or 7 (`null` = no lower limit).
The app re-reads the `eew` section within a second of any change. The server applies
`wallpaper.hidden` (widget `use` ids), `page_seconds`, `theme`, `arrangement` and `acknowledged`;
`providers` is read when the server starts.

### Screenshots
`tools/wallshot out.jpg [screen]` captures only the wallpaper window, without the windows in
front of it, as a JPEG at most 1600 px wide. Your terminal needs the Screen Recording permission.

### Defaults (`defaults write io.github.daiconman.orbit-desktop <key> <value>`)
| key | default | meaning |
|---|---|---|
| `port` | `47900` | loopback port of the server |
| `repoPath` | (bundle copy) | serve runtime/widgets from a checkout so edits show without a rebuild |
| `python` | CLT `python3`, else `/usr/bin/python3` | interpreter for the server. The app prefers `/Library/Developer/CommandLineTools/usr/bin/python3` and sets `DEVELOPER_DIR` to the CLT for the server, because a selected Xcode whose license hasn't been accepted breaks the `/usr/bin` shims. `build.sh` falls back the same way. |
| `devtools` | `false` | make the desktop web views inspectable from Safari's Develop menu |

## Layout
```
Sources/OrbitDesktop/
  main.swift, AppDelegate.swift   menu bar, 確認事項, which providers run, lifecycle
  DesktopWindows.swift            desktop-level windows, page messages, click zones, WKWebView hardening
  Actions.swift                   widget click actions (url / app / shortcut / script / music)
  ServerProcess.swift             child server process + tiny API client
  SystemProvider.swift            system stats (Mach / sysctl / IOKit)
  AudioProvider.swift             Core Audio process tap + FFT
  CalendarProvider.swift          EventKit
  EEWProvider.swift               緊急地震速報 / tsunami WebSocket, alerts.json, music pause
  EEWBanner.swift                 on-screen banner + notifications
  SettingsWindow.swift            設定 window (SwiftUI) + login item
  AppSettings.swift               settings.json (+ one-time migration)
  Paths.swift                     paths and settings
Support/Info.plist                bundle id, usage descriptions, LSUIElement
build.sh                          swift build + bundle + codesign
```
