# Starfield (background)

The real night sky over your configured location, redrawn live: stars brighter than magnitude 6
(Yale Bright Star Catalogue via d3-celestial, BSD-3-Clause - see `data/LICENSE`), the Milky Way,
the five naked-eye planets and the Moon with its current phase, Sagittarius A* when it is up,
meteors, flowing network "streamlines", and an occasional UFO.

The projection is zenith-centred (north up, east left - as when lying on your back looking up)
and follows sidereal time, so the sky slowly rotates through the day.

## Signals (`needs`)
`system` (CPU / network), `audio` (spectrum), `nowPlaying` (audio reactions only count while music
plays), `location` (where to compute the sky for).

## Reaction hooks
| hook | effect | default source |
|---|---|---|
| `twinkle` | twinkle strength & speed | `cpu` |
| `meteors` | shooting-star rate | `cpu` |
| `heat` | warm bottom glow, pulsing edges above 0.7 | `cpu` |
| `streamlines` | number / speed / length of flow lines | `net` |
| `glow` | Milky Way + bright-star flare | `audio.bass` |

Override in `layout.yaml`, e.g. `react: { audio.high: meteors, audio.bass: [glow, twinkle] }`.

## Settings
See `widget.yaml` (fps, milky_way, planets, moon, black_hole, labels, meteors, streamline_count,
ufo, vignette, scanlines, heat_glow, time_scale).

Planet positions use Paul Schlyter's simplified orbital elements (~1 degree accuracy).
