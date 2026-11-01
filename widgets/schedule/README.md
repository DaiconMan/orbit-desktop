# Schedule

Gantt-style timeline of the calendar around "now" (default: 2 h back, 10 h ahead), all-day events as
chips, and a `NEXT hh:mm · in N min` countdown.

- **needs:** `calendar`, `time`
- **settings:** `title`, `hours_before`, `hours_after`, `max_rows`, `show_all_day`, `backdrop`
- **provider:** `providers.calendar.file`, written by the `host/helpers/calpulse` EventKit helper
  (needs Calendar permission). Without the helper the widget shows "no more events".
