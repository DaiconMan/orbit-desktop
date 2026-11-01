# Orbit Desktop.app (Swift host)

A small menu-bar app that puts the Orbit runtime on your desktop and owns every macOS
permission. It replaces Plash and the separate helpers.

* **Desktop windows**: one borderless window per screen at desktop level (below the Finder
  icons), on every Space, click-through, each showing a `WKWebView` of the runtime page.
* **Server**: it starts `host/dev-server/orbit_server.py` as a child process, restarts it if it
  crashes, and the server exits by itself if the app goes away (`--parent-pid`).
* **Native providers**: the app measures these itself and drops them as JSON into
  `~/Library/Caches/orbit-desktop/host/`, which the server reads (`--host-dir`):

  | signal | how | permission |
  |---|---|---|
  | `system` cpu / load / mem / disk / net | Mach `host_statistics`, `sysctl NET_RT_IFLIST2`, IOKit block-storage stats, every 2 s. No `ps`, `vm_stat`, `netstat` or `iostat` processes. | none |
  | `audio` | Core Audio process tap (macOS 14.2+). It follows output-device changes, and writes once a second during silence. | System Audio Recording Only |
  | `calendar` | EventKit, today and tomorrow, every 5 min and on changes | Calendars (full access) |

  The audio and calendar providers start only when the active layout uses a plugin that
  `needs:` them, so you never get a prompt for a widget you don't use. Now playing still comes
  from the server's AppleScript calls. Because the server is the app's child process, the
  Automation prompt also names Orbit Desktop.
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

Use the ✦ menu-bar icon to:
* reload the wallpaper
* edit `layout.yaml` (the first time, it copies the example to `~/.config/orbit-desktop/`)
* open a `?demo` preview in the browser
* show the server log (`~/Library/Logs/OrbitDesktop/server.log`)
* restart the server
* start at login

### Keeping permissions across rebuilds
macOS ties permission grants to the code signature. The default ad-hoc signature changes with
every build, so calendar and audio grants reset after each rebuild. To keep them, create a
self-signed certificate once:
1. Open Keychain Access and choose Certificate Assistant › Create a Certificate…
2. Name it `Orbit Desktop Dev`, with identity type Self Signed Root and certificate type Code Signing.
3. Build with `ORBIT_SIGN_IDENTITY="Orbit Desktop Dev" host/app/build.sh`.

### Settings (`defaults write io.github.daiconman.orbit-desktop <key> <value>`)
| key | default | meaning |
|---|---|---|
| `port` | `47900` | loopback port of the server |
| `repoPath` | (bundle copy) | serve runtime/widgets from a checkout so edits show without a rebuild |
| `python` | `/usr/bin/python3` | interpreter for the server |
| `devtools` | `false` | make the desktop web views inspectable from Safari's Develop menu |

## Layout
```
Sources/OrbitDesktop/
  main.swift, AppDelegate.swift   menu bar, which providers run, lifecycle
  DesktopWindows.swift            desktop-level windows + WKWebView hardening
  ServerProcess.swift             child server process + tiny API client
  SystemProvider.swift            system stats (Mach / sysctl / IOKit)
  AudioProvider.swift             Core Audio process tap + FFT
  CalendarProvider.swift          EventKit
  Paths.swift                     paths and settings
Support/Info.plist                bundle id, usage descriptions, LSUIElement
build.sh                          swift build + bundle + codesign
```
