# Writing widgets for Orbit Desktop

A widget is a small folder: a manifest, one JavaScript file, optional CSS. There is no build step and no npm.
It runs in a **sandboxed, network-less frame**. Data reaches it only through the **signals** it declares, so a
widget cannot leak your calendar or listening history.

This page is the complete reference. For AI agents there is a short operational version, [AGENTS.md](../AGENTS.md),
plus machine-readable contracts:

| what | where |
|---|---|
| SDK types | [`runtime/sdk/orbit-sdk.d.ts`](../runtime/sdk/orbit-sdk.d.ts) |
| manifest schema | [`schemas/widget.schema.json`](../schemas/widget.schema.json) |
| signal payload schemas | [`schemas/signals/<name>.schema.json`](../schemas/signals/), index: [`schemas/signals/index.json`](../schemas/signals/index.json) |
| sample payloads (no personal data) | [`examples/mock/<name>.json`](../examples/mock/), all in one: `examples/mock/all.json` |
| bundled widgets to copy from | [`widgets/`](../widgets/) |

## 1. Five-minute start

```sh
python3 tools/new-widget.py tide --name "Tide" --needs time,weather --category weather --ja-name 潮
python3 tools/dev-widget.py tide              # http://127.0.0.1:47950/?debug — reloads on every save
python3 tools/dev-widget.py tide --shot tide.png   # one off-screen screenshot (macOS)
python3 tools/validate.py                     # must print OK
```

`dev-widget.py` serves only your widget, with the sample payloads from `examples/mock/all.json`, so you don't
need the host app, the providers or any permission. Use `--mock my.json` to fake a condition (an alert, an empty
calendar, a playing track), `--settings '{"title":"X"}'`, `--width 24vw` and `--locale en-US`.

If `python3` or `swift` complain about the Xcode license, run them with
`DEVELOPER_DIR=/Library/Developer/CommandLineTools`.

## 2. The folder

```
widgets/<id>/            (or ~/.config/orbit-desktop/widgets/<id>/ for your own)
  widget.yaml   manifest (required)
  widget.js     code (required, ≤ 512 KB)
  style.css     optional
  README.md     required: what it shows, needs, settings
  LICENSE       optional
  data/…        optional data assets (.json / .txt / .csv ≤ 4 MB) listed under `assets:`
```

## 3. Manifest (`widget.yaml`)

The full schema is [`schemas/widget.schema.json`](../schemas/widget.schema.json). A typical one:

```yaml
id: tide                      # = folder name, ^[a-z0-9][a-z0-9-]{1,40}$
name: Tide
version: "0.1.0"              # quoted semver
author: you
license: MIT
kind: widget                  # or background
category: weather             # time | weather | system | dev | life | media (library group)
description: "High and low tide times for the next 24 hours."
needs: [time, weather]        # the ONLY data your code receives
default_size: { width: 18vw, height: auto }
settings:
  title:   { type: string,  default: "TIDE", description: "Header label" }
  hours:   { type: integer, default: 24, min: 6, max: 72 }
  style:   { type: enum, options: [compact, full], default: compact }
i18n:                         # names in the layout editor's library and inspector
  ja:
    name: 潮
    description: これから24時間の満潮・干潮
    settings: { title: 見出し, hours: 表示する時間, style: 表示 }
    options:  { style: { compact: 小さく, full: 詳しく } }
actions: []                   # host actions your buttons may request: music, mount
```

The layout editor builds the inspector form from `settings:`: boolean → checkbox, enum → menu,
number / integer → input with min/max, list → text box, anything else → text field. Keep only settings a user would
plausibly change, and make the defaults look good.

## 4. Code (`widget.js`)

```js
(() => {
  'use strict';
  const { esc, kv } = Orbit.ui;
  let m = null;
  Orbit.widget({
    mount(ctx) { m = Orbit.module(ctx, ctx.settings.title); ctx.visible(false); },
    on: {
      weather(w, ctx) {
        if (!w || !w.current) return ctx.visible(false);         // nothing to show: take no space
        m.meta.textContent = esc(w.place || '');
        m.body.innerHTML = kv('NOW', `${Math.round(w.current.temperature_2m)}°`);
        ctx.visible(true);
      },
      time(t, ctx) { /* 1 Hz tick: { now, locale, hour12, tz } */ },
    },
    theme(ctx) { /* palette / screen / scale changed: re-render if you cache sizes */ },
  });
})();
```

* `ctx` is described in the d.ts: `root`, `settings`, `signals` (latest value of every need), `theme` (with a palette
  that follows the album artwork), `locale` / `lang` / `hour12`, `viewport`, `scale`, `assets`, `esc()`, `rgb()`,
  `visible()` and `action()`.
* **Units:** inside the frame, `vh` / `vw` refer to the frame. Use the host-screen units the SDK provides:
  `calc(var(--vh) * 1.3)`. They also carry the editor's size slider.
* **Look:** `Orbit.module(ctx, 'TITLE')` gives the shared frame (small spaced caps header, hairline, meta, body).
  The SDK CSS has `.kv` `.row` `.tile(s)` `.meter` `.lst` `.big` `.foot` `.warn` `.ok` and the type tokens
  `--t-xs … --t-hero`, `--mono`, `--disp`, `--rule`, plus the palette `rgb(var(--c))`. Reuse them so your widget looks
  like the others: dark, calm, small monospace labels, thin numbers, no garish colours, no blinking.
* **Escape** every string that comes from a signal (`esc()` or `textContent`). Calendar titles, track names and
  news headlines are untrusted.
* **Hide when empty** (`ctx.visible(false)`) instead of showing "—" rows.
* **Performance:** the target is a fanless MacBook Air. Re-render on signal updates only, never in a
  `requestAnimationFrame` loop (backgrounds are the exception, with an fps cap). Don't build large DOM trees
  every second.

## 5. Signals

`schemas/signals/index.json` lists every signal with its update interval, the provider that must be enabled and
whether it is sensitive. The schemas describe every field with its unit. The commonly used ones:

| signal | what |
|---|---|
| `time` | 1 Hz tick from the runtime |
| `system` | cpu %, memory, disk MB/s, network bytes/s, ping, speed test |
| `weather` | Open-Meteo current / hourly / daily (+ air quality, pressure, 15-min nowcast) and place name |
| `calendar` | events today + 8 days |
| `nowPlaying` | Music / Spotify track, position, artwork (data URL) |
| `audio` | ~20 Hz levels and 16 bands (mostly for backgrounds) |
| `mac`, `power`, `network`, `cloud`, `bluetooth` | battery, USB-C input, home / Tailscale / NAS, cloud folders, devices |
| `quakes`, `alerts`, `holidays`, `fx`, `news`, `iss`, `kp`, `launches`, `onthisday` | public data (opt-in providers) |

A widget gets a signal only if the user has the matching provider on. The library shows "データ源がオフ" with
an "オンにする" button, so design for missing data.

## 6. Click actions

Widgets can't open URLs or run anything themselves. A user can attach a click action to any widget in the editor
(open an app or a URL, run a Shortcut or a script). If your widget has its own buttons for a host feature, declare
it in `actions:` and call `ctx.action(type, value)`:

| type | values |
|---|---|
| `music` | `playpause`, `next`, `previous`, `shuffle`, `repeat`, `playlist:<name>` |
| `mount` | a NAS share name (toggle mount) |

## 7. Backgrounds

`kind: background` plugins draw on a full-screen canvas with `Orbit.background({ fps, setup, resize, frame })`.
`frame(ctx, f)` receives normalised levels (`f.levels.cpu`, `f.levels.audio.bass`, …) and the layout's `react:`
mapping (`f.react.twinkle`, …). Keep `fps` ≤ 20–30 and draw at 1x DPR with prerendered sprites. See
`widgets/starfield`.

## 8. Rules (the review checklist)

* No network, storage, `eval` or navigation: the sandbox blocks them, and the validator flags attempts.
* `needs:` lists exactly what you read. Sensitive signals (calendar, location, nowPlaying, network, …) need a reason
  in the README.
* No hard-coded personal data: hosts, names, locations or repos. Take them from signals or settings.
* README: what it shows, needs, settings, data source.
* `python3 tools/validate.py` prints OK; a screenshot from `dev-widget.py --shot` is in the PR.
