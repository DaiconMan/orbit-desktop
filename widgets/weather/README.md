# Weather

Current conditions (icon, temperature, today's high / low), every 3rd hour of the next 12 hours, the
next days, and an extra line with rain within the hour ("15分後から雨"), the umbrella hint for the rest
of today's daytime (≥ 50 %), UV index, PM2.5 and AQI. The header shows the place name. Hidden until the
first forecast arrives.

- **needs:** `weather` (the host fetches Open-Meteo for `providers.location`, no API key; `air` is an
  optional sub-key with `pm25` / `aqi`)
- **settings:** `hour_step` (3), `days` (4), `show_aux` (true), `show_attribution` (true)
- **Attribution:** Open-Meteo data is licensed CC BY 4.0. The widget shows
  "Weather data by Open-Meteo.com" by default; if you turn it off, credit Open-Meteo elsewhere.
