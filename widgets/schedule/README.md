# Schedule

One-day horizontal timeline: thin coloured bars on an hour axis (overlapping events get lanes), each
with a 1px leader line to a two-line label (title / time). Labels are placed by a small cost search
(three rows above the axis, two below, right or left of the leader) so they never overlap and leaders
avoid crossing other labels. The header shows `TODAY`, all-day events as chips, and `NOW` (the
current event and when it ends) / `NEXT` (start time and countdown). The axis spans 8-20 h by
default and widens to hold every event and the current time; the now mark sits on it.

- **needs:** `calendar`, `time`
- **settings:** `title`, `start_hour`, `end_hour`, `max_rows`, `show_all_day`, `backdrop`, `bleed`, `demo`
- **provider:** `providers.calendar.file`, written by the host app's EventKit provider
  (needs Calendar permission). Without it the widget shows `予定なし`.

## Placement
The axis stays at a fixed height inside the widget; anchored at bottom 4vh, its hour numbers share the
clock's 11vh baseline. The prototype spanned left 40vw ... right 6vw:

```yaml
- use: schedule
  position: { anchor: bottom-right, x: 6vw, y: 4vh, width: 54vw }
```

The prototype's scrim extended 4vw beyond the timeline on each side. A frame cannot draw outside
itself, so for exactly that look widen the frame and inset the timeline with `bleed`:

```yaml
- use: schedule
  position: { anchor: bottom-right, x: 2vw, y: 4vh, width: 62vw }
  settings: { bleed: 4 }
```

`demo: true` renders a dense synthetic day for previewing (the prototype's `?cal=demo`; URL flags of
the host page do not reach plugin frames).

v1.1.0 replaced the rolling `hours_before` / `hours_after` window with the prototype's one-day axis
(`start_hour` / `end_hour`). `hours_before` / `hours_after` are still accepted but ignored.
