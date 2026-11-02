# Month Calendar

The current month as a compact grid: today ringed in the accent colour, past days dimmed, Sundays and
public holidays red, Saturdays blue, and a dot under days that have events. This month's holidays are
listed underneath.

- Signals: `time`, `calendar` (events, today + 8 days), `holidays` (opt-in `providers.holidays`; uses `map`).
- All-day events whose title matches a holiday are not counted as events.
- Settings: `event_dots`, `holiday_list`.
