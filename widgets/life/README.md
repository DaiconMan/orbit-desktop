# Life

Key / value rows for the next Japanese public holiday (date and "あと N日"), USD/JPY with the change from
the previous close, and the latest earthquake of intensity 3 or more in the last 24 hours (amber from
震度5弱). The header shows whether the Earthquake Early Warning stream is live.

- **needs:** `holidays`, `fx`, `quakes`, `alerts` (only `alerts.ws` and `alerts.eewEnabled` are read here)
- **settings:** none
- **Data:** holidays, FX and quakes are opt-in host providers (P2PQuake / JMA for quakes).
