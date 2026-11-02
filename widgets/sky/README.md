# Sky Chart

A small horizon chart of what is above you right now: Sun, Moon (rendered with its current phase),
the five naked-eye planets and the ISS. Zenith is the centre, the outer circle is the horizon,
north is up and east is left (as when lying down and looking up).

- Signals: `time`, `location`, `iss` (opt-in `providers.iss`).
- Positions are computed locally (Schlyter's orbital elements). Redrawn at most every 10 seconds; no animation.
- Settings: `iss`, `labels`.
