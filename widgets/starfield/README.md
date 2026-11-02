# Starfield (background)

The real night sky over your configured location, redrawn live: stars brighter than magnitude 6
(Yale Bright Star Catalogue via d3-celestial, BSD-3-Clause - see `data/LICENSE`), the Milky Way,
the five naked-eye planets (very bright ones with faint diffraction spikes) and the Moon with its
current phase, Sagittarius A* when it is up, the ISS when it passes overhead, meteors (on the peak
night of an annual shower they also fly away from its radiant), flowing network "streamlines", and an
occasional UFO. Page-level layers: an optional blurred artwork backdrop, a vignette, faint scan lines,
and a warm load glow from the bottom with a pulsing edge when the machine is hot.

Performance: drawn at 1x DPR with prerendered sprites; `fps` (default 20) while something moves
(music, load, traffic, meteors, UFO), half of it for a quiet sky.

The projection is zenith-centred (north up, east left - as when lying on your back looking up)
and follows sidereal time, so the sky slowly rotates through the day.

## Signals (`needs`)
`system` (CPU / network), `audio` (spectrum), `nowPlaying` (audio reactions only count while music
plays; frame rate; artwork for the backdrop), `location` (where to compute the sky for), `iss`
(ISS position; enable `providers.iss`).

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
See `widget.yaml` (fps, milky_way, planets, moon, black_hole, labels, meteors, showers, iss,
streamline_count, ufo, art_backdrop, vignette, scanlines, heat_glow, time_scale).

`art_backdrop` is off by default: in the prototype the backdrop sat underneath the opaque sky canvas,
so it was never actually visible. Turn it on for a faint (.16) blurred tint of the current artwork.

Planet positions use Paul Schlyter's simplified orbital elements (~1 degree accuracy).
