# World Clock

Time tiles for a list of time zones (two per row). Each tile shows the local time there, the
offset in hours from your own time zone, and 昨日 / 明日 when the date there differs.

- Signals: `time`.
- Settings: `clocks` (list of `{label, tz}`, IANA zone names), `home_tz` (reference zone; empty = system).
