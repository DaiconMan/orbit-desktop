# Countdown

Rows of "what · how long": the next timed (busy) calendar event, the next public holiday, the weekly
Claude usage reset and the next annual meteor shower peak (22:00 local on the peak date). Rows without
data are left out. Updates every minute.

- **needs:** `time`, `calendar`, `holidays`, `claudeUsage`. The Claude row appears only when the
  **unofficial** `claudeUsage` provider is enabled (it reads an undocumented field of `~/.claude.json`).
- **settings:** `meteors` (true)
