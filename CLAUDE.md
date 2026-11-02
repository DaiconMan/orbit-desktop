# Orbit Desktop — notes for Claude Code sessions

Live, config-driven desktop wallpaper for macOS: a starfield background (real sky) plus widgets
(clock, weather, system stats, now playing, schedule, …), all defined as plugins and laid out via YAML.
Communicate with the owner in Japanese.

## Origin
Spun out on 2026-11-02 from a personal prototype built in the `mac-setup` session (a Plash page + Python server).
On 2026-11-03 everything was ported here, and **Orbit Desktop.app (~/Applications) became the owner's live wallpaper**,
including the Earthquake Early Warning, which is safety-relevant: never leave it broken or stopped. The prototype is
being deleted. The owner's layout is in `~/.config/orbit-desktop/layout.yaml` (personal hosts live there, never in the
repo), and the settings window writes `~/.config/orbit-desktop/settings.json`.
- Screenshot the live wallpaper with `tools/wallshot out.jpg`; render any page off-screen with `swift tools/snap.swift`.
- After changing runtime/ or widgets/, rebuild and reinstall (`host/app/build.sh --install`): the app serves the
  copy inside its bundle.
- If Xcode's license isn't accepted, `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` before python3/swift.

## Decisions already made (do not re-litigate)
- Own host app in Swift (desktop-level window + WKWebView) will replace Plash; providers move into it so all
  macOS permissions live in one app.
- License: MIT. Copyright holder "DaiconMan".
- No Apple Developer ID signing/notarization for now; distribute as build-from-source first, Homebrew later.
- Backgrounds are plugins too (`kind: background`), plus YAML-only built-ins (color, gradient, image, video).
- Community plugins run in sandboxed iframes with a no-network CSP and receive only the signals declared in
  `needs:`. See `docs/security.md`.
- Privacy-first defaults: no hardcoded personal hosts/locations; IP geolocation, speed test, artwork search
  fallback and the unofficial Claude-usage reader are off by default.

## Owner's taste (learned the hard way in the prototype)
Likes: dark, calm, minimal; real night sky; CPU → star twinkle + meteors; network → laminar streamlines;
big thin clock; monospace HUD with sparklines.
Dislikes: wobbly/"fuyofuyo" particle motion, aurora bands, constellation lines, garish/strong effects,
bright artwork glow, overlapping elements, hidden clock, vertical schedule, text crammed into small boxes.

## Repo
- GitHub: `DaiconMan/orbit-desktop` (private for now; may be made public later or a clean public repo created).
- Conventional Commits. Validate with `python3 tools/validate.py`.
- Dev server: `python3 host/dev-server/orbit_server.py` — use a port other than 47800 (the prototype).
- JS syntax check without node: `osascript -l JavaScript -e "... new Function(src) ..."` (see phase-1 notes).

## Swift host app (host/app) — hybrid, decided 2026-11-02
- The app owns the desktop windows, the menu bar and the native providers: system stats, the audio tap
  and EventKit. It writes JSON files into `~/Library/Caches/orbit-desktop/host/`.
- It runs `orbit_server.py --host-dir … --parent-pid …` as a child process. Config validation, frames
  and the HTTP API stay in Python, with no second implementation in Swift.
- Bundle id: `io.github.daiconman.orbit-desktop`. Build with `host/app/build.sh` (SwiftPM, no Xcode).
  Ad-hoc signing resets TCC on every rebuild; use `ORBIT_SIGN_IDENTITY` with a self-signed cert.
- Core Audio set-up/tear-down can block while a TCC prompt is open, so keep it off the main thread
  (it froze quitting once).
- Check what the desktop shows with `screencapture -l <windowID>`. The window is at layer -2147483623,
  owner "Orbit Desktop".

## Modules (docs/modules.md)
The owner wants widgets to be topic **modules** that bundle related info (handed over from mac-setup on
2026-11-02; the design is ours). Personal or environment-specific data (RFCs, certs) comes from trusted
**feeds**, never from sandboxed widgets. Port prototype visuals per module once its UI pass settles.

## Next steps
0. Modules: follow the order of work in docs/modules.md §7 (SDK module kit + stacks first).
1. Host app follow-ups: CoreLocation provider, now playing in-process (AppleScript or MediaRemote),
   pause rendering when the screen sleeps or is locked, layout picker in the menu.
2. Port the latest prototype UI (schedule timeline with leader lines, now-playing slide-in / slow "aha" fade-out,
   Tailscale/NAS mount rows, battery/Time Machine/GitHub/RFC/ISS panels if they prove useful).
3. Performance budget: MacBook Air is fanless — cap the background at ~20 fps, sprite-based drawing.
4. README screenshots, CONTRIBUTING polish, Homebrew cask, decide on public release.
