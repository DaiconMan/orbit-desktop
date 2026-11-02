# Clock

Large thin clock with the date underneath, formatted with `theme.locale` and `theme.hour12`, and a
meeting countdown below the date: during an event `会議中 · <title> · 残り N分`, otherwise the next
event that starts within 15 minutes (`<title> まで N分`). All-day and "free" events are ignored.

- **needs:** `time`, `calendar`
- **settings:** `show_date` (bool), `seconds` (bool), `size` (font size in host vh, default 15),
  `meeting` (bool, default true), `meeting_lead` (minutes, default 15)

## Placement
The frame cannot draw outside its own box, so with `meeting: true` the widget always reserves the
countdown row (3.2vh) below the date - the clock never moves when it appears. To keep the date on the
page's 11vh alignment line (where the schedule's hour numbers sit), anchor it 3.2vh lower:

```yaml
- use: clock
  position: { anchor: bottom-left, x: 6vw, y: 7.8vh }
```

With `meeting: false` use `y: 11vh`.
