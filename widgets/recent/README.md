# Recent Tracks

The most recent tracks from the local play history (title, artist, `N分前`). When the newest entry is
the track currently loaded in Music / Spotify, it is highlighted and marked 再生中 or 一時停止.
Hidden while the history is empty.

- Signals: `recent` (`providers.recent`, local only), `nowPlaying`, `time`.
- Settings: `count` (default 5).
- Uses the shared `.lst` list style from the SDK module kit.
