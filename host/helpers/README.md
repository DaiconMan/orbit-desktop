# Host helpers (optional)

Small native helpers that feed the dev server's providers through local JSON files. None of them
touch the network. All are optional: without them the `audio` / `calendar` signals stay empty.

| helper | feeds | permission | output (default) |
|---|---|---|---|
| `audiopulse` | `audio` | *System Audio Recording Only* (macOS 14.2+ process tap) | `~/Library/Caches/orbit-desktop/audiopulse.json` |
| `calpulse` | `calendar` | Calendars (full access) | `~/Library/Caches/orbit-desktop/calendar.json` |
| `tcp-latency.sh` | `system.ping` via `providers.ping.external_file` | Local Network (from Terminal) | `~/Library/Caches/orbit-desktop/latency.json` |

Build and run:

```sh
swiftc -O -o ~/.local/bin/orbit-audiopulse host/helpers/audiopulse/main.swift
swiftc -O -o ~/.local/bin/orbit-calpulse   host/helpers/calpulse/main.swift
~/.local/bin/orbit-audiopulse &      # optional arg: output path
~/.local/bin/orbit-calpulse &
host/helpers/tcp-latency.sh NAS=192.168.1.10:22 &
```

For always-on use, wrap them in your own LaunchAgents (the future Swift host app will run these
in-process, so no LaunchAgent templates ship in phase 1).

`audiopulse` output: `{"level", "bass", "mid", "high", "bands": [16 log-spaced bands 40 Hz–12 kHz], "ts"}`,
about 20 times a second. `calpulse` output: `{"events": [{title, start, end, allDay, calendar, color, location, status}], "ts"}`
for today and tomorrow, refreshed every 5 minutes and on calendar changes.
