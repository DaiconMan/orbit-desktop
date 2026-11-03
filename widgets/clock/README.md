# Clock

Large thin clock with the date underneath, and a meeting countdown below the date: during an event
`会議中 · <title> · 残り N分`, otherwise the next event that starts within `meeting_lead` minutes
(`<title> まで N分`). All-day and "free" events are ignored. Text follows `theme.locale`.

- **needs:** `time`, `calendar`

## Settings

| setting | values | default | |
|---|---|---|---|
| `format` | `auto` / `24h` / `12h` | `auto` | `auto` follows `theme.hour12`. 12-hour time has no leading zero and a small AM/PM (午前/午後) |
| `seconds` | bool | `false` | show seconds |
| `date_style` | `long` / `short` / `numeric` / `none` | `long` | `11月4日 水曜日` / `11/4 (水)` / `2026-11-04` / no date |
| `show_date` | bool | `true` | legacy switch: `false` is the same as `date_style: none` |
| `size` | 2–40 | `15` | font size of the time in host vh |
| `weight` | `thin` / `light` / `regular` / `medium` | `thin` | font weight 200 / 300 / 400 / 500 |
| `color` | `theme` / `accent` | `theme` | `theme` = `theme.text_color`; `accent` = the accent colour (follows the artwork with `theme.accent: auto`). Only the time is tinted; the date stays in the text colour |
| `meeting` | bool | `true` | meeting countdown under the date |
| `meeting_lead` | 1–120 | `15` | minutes before an event that it appears |

```yaml
- use: clock
  position: { anchor: bottom-left, x: 6vw, y: 7.8vh }
  settings: { format: 12h, date_style: short, weight: light, seconds: true }
```

## Placement
The frame cannot draw outside its own box, so with `meeting: true` the widget always reserves the
countdown row (3.2vh) below the date - the clock never moves when it appears. To keep the date on the
page's 11vh alignment line (where the schedule's hour numbers sit), anchor it 3.2vh lower:

```yaml
- use: clock
  position: { anchor: bottom-left, x: 6vw, y: 7.8vh }
```

With `meeting: false` use `y: 11vh`. With `date_style: none` the date row (about 3.6vh) disappears
too, so the time itself drops by that much when the widget is anchored at the bottom.
