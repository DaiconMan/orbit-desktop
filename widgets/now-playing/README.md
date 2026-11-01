# Now Playing

Artwork, title, artist, album and a progress bar for Apple Music or Spotify. Fades out when
nothing is playing. With `theme.accent: auto`, the host derives the glow palette from the artwork
and every plugin picks it up.

- **needs:** `nowPlaying` (artwork arrives as a `data:` URL - the frame cannot load remote images)
- **settings:** `show_album`, `show_progress`, `show_source`, `max_width` (host vw)
- **provider:** `providers.now_playing` - apps are queried via AppleScript only when already running.
  The first query triggers macOS' Automation permission prompt for the terminal / host app.
