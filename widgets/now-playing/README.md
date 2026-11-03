# Now Playing

Artwork (17vh, crossfading between tracks), an eyebrow `NOW PLAYING · APPLE MUSIC` (or `PAUSED`,
`SPOTIFY`), title, artist, album and a progress bar for Apple Music or Spotify.

Motion: when playback starts the stage glides in from the left (1.8 s, expo-out) with the text
following a beat later; on a track change the text dips out and back while the artwork crossfades;
when playback stops it dissolves - drifting, desaturating and blurring - over ~80 s. Pausing keeps it
on screen with `PAUSED`. With `theme.accent: auto` the host derives the palette from the artwork, and
the source label (and every other plugin) picks it up.

- **needs:** `nowPlaying` (artwork arrives as a `data:` URL - the frame cannot load remote images)
- **settings:** `show_album`, `show_progress`, `show_source`, `max_width` (host vw, default 32)
- **provider:** `providers.now_playing` - apps are queried via AppleScript only when already running.
  The first query triggers macOS' Automation permission prompt for the terminal / host app.

## Placement
A frame cannot draw outside its own box, so the widget pads itself (2vh top, 3vw right, 4vh bottom)
to keep the cover shadow and the title glow from being clipped. To put the stage where the prototype
had it (bottom 33vh), anchor it 4vh lower:

```yaml
- use: now-playing
  position: { anchor: bottom-left, x: 6vw, y: 29vh }
```

The glide starts 70vw to the left as in the prototype but becomes visible at the frame's left edge
(x), softened by a 6vw feather that slides away once the stage has arrived.

## Playback buttons
With `controls: true` (default) the widget shows previous / play-pause / next and shuffle / repeat buttons.
Up to three `playlists` (Music playlist names, or `spotify:` URIs) appear as buttons. When nothing is
playing, they stay visible under the stage, so you can start a playlist. The buttons ask the host app to
control Music or Spotify (manifest `actions: [music]`); the widget itself can't reach the players.
