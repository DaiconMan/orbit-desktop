# Contributing to Orbit Desktop

Thanks for helping! Most contributions are **widgets** and **backgrounds**. Both are plain
folders with no build step.

## Dev loop

```sh
python3 host/dev-server/orbit_server.py --port 47900 --config examples/layout.yaml
open "http://127.0.0.1:47900/?demo"     # ?demo fakes CPU / network / audio / a playing track
python3 tools/validate.py               # must print OK before you open a PR
```

The page reloads by itself when a `widget.yaml` or the layout changes. Reload manually after
editing `widget.js` or `style.css`. Plugin errors appear in the red panel at the top of the page.

## Anatomy of a plugin

```
widgets/<id>/
  widget.yaml   manifest (required)
  widget.js     code (required, ≤ 512 KB)
  style.css     optional
  README.md     required: what it shows, needs, settings, data sources
  LICENSE       optional, if it differs from the repo's MIT
  data/…        optional data assets (.json/.txt/.csv ≤ 4 MB), listed under `assets:`
```

Nothing else is allowed in the folder (the validator enforces this). Community plugins can also be
dropped into `~/.config/orbit-desktop/widgets/<id>/`. A bundled plugin with the same id wins.

### Manifest reference (`widget.yaml`)

| key | required | notes |
|---|---|---|
| `id` | ✓ | `^[a-z0-9][a-z0-9-]{1,40}$`, equal to the folder name. `color`/`gradient`/`image`/`video` are reserved. |
| `name` | ✓ | display name |
| `version` | ✓ | semver, **quoted**: `"1.0.0"` |
| `author` | ✓ | |
| `license` | ✓ | SPDX id; must be compatible with redistribution here (MIT, BSD, Apache-2.0, …) |
| `kind` | ✓ | `widget` or `background` |
| `description` | | one paragraph |
| `needs` | | list of signals: `time`, `system`, `audio`, `nowPlaying`, `calendar`, `weather`, `location`, `claudeUsage`. **Only these reach your code.** |
| `settings` | | schema, see below |
| `default_size` | | widgets: `{width, height}` CSS lengths or `auto` |
| `assets` | | relative paths of data files the host loads and passes to you as `ctx.assets[path]` |
| `reactions` | | backgrounds: `{hooks: {name: description}, default: {source: hook \| [hooks]}}` |
| `unofficial` | | `true` if you depend on undocumented / unofficial data (shown as a warning) |
| `homepage`, `min_runtime` | | informational |

**Settings schema:** each entry is `name: {type, default, description?, min?, max?, options?, items?}`.

| type | value |
|---|---|
| `string` | |
| `number` | |
| `integer` | |
| `boolean` | |
| `color` | `"#rrggbb"`, `rgb()`, `rgba()` or a named colour |
| `length` | number (px) or `"12px"`, `"3vh"`, … |
| `enum` | one of `options` |
| `list` | list; `items` is a spec for the elements |

Users override settings per instance in `layout.yaml`. Unknown keys and wrong types are reported
on screen.

### Widget example

`widgets/hello/widget.yaml`
```yaml
id: hello
name: Hello
version: "1.0.0"
author: you
license: MIT
kind: widget
needs: [time]
settings:
  greeting: { type: string, default: "Hello" }
```

`widgets/hello/widget.js`
```js
Orbit.widget({
  mount(ctx) { ctx.root.innerHTML = '<div class="hi"></div>'; },
  on: {
    time(t, ctx) {
      ctx.root.firstChild.textContent = `${ctx.settings.greeting} — ${new Date(t.now).toLocaleTimeString(ctx.locale)}`;
    },
  },
  theme(ctx) { /* optional: palette or screen size changed */ },
});
```

`widgets/hello/style.css`
```css
.hi { font: 300 calc(4 * var(--vh)) var(--font); color: rgb(var(--c)); }
```

### Background example

```yaml
id: pulse-grid
name: Pulse grid
version: "1.0.0"
author: you
license: MIT
kind: background
needs: [system, audio]
reactions:
  hooks: { brightness: "Grid brightness", speed: "Scroll speed" }
  default: { audio.bass: brightness, cpu: speed }
settings:
  color: { type: color, default: "#46dcc8" }
```
```js
let y = 0;
Orbit.background({
  fps: 30,                               // the user can override this with a `fps` setting
  setup(ctx) { /* ctx.canvas, ctx.g (2D context), ctx.W, ctx.H, ctx.DPR, ctx.assets */ },
  resize(ctx) {},
  frame(ctx, f) {                        // f = { t, dt, levels, react, signals }
    const g = ctx.g; y = (y + f.dt * (20 + 200 * f.react.speed)) % 40;
    g.fillStyle = '#05060a'; g.fillRect(0, 0, ctx.W, ctx.H);
    g.strokeStyle = ctx.settings.color; g.globalAlpha = .15 + .6 * f.react.brightness;
    for (let v = y; v < ctx.H; v += 40) { g.beginPath(); g.moveTo(0, v); g.lineTo(ctx.W, v); g.stroke(); }
    g.globalAlpha = 1;
  },
  on: { /* optional raw signal handlers */ },
});
```

### SDK reference (`window.Orbit`)

`ctx` contains:
* `root`: your container element
* `settings`: frozen
* `theme`
* `locale`, `lang` (`'ja'`, `'en'`, …) and `hour12`
* `viewport {w, h}`
* `assets`
* `signals`: the latest value of each signal
* `esc(str)`: HTML-escape
* `rgb('a'|'b'|'c')`: a palette triplet

`f.levels` holds normalised `{cpu, net, audio: {level, bass, mid, high, bands[16]}}`. `f.react`
holds hook values (0..1) after the user's `react:` mapping.

`Orbit.spark(canvas, history, value, max, color)` draws a sparkline.

Exceptions thrown from your callbacks are caught and shown in the on-screen problems panel.

Widgets are sized automatically (`width/height: auto`): the SDK measures `#orbit-root` and the
host resizes your frame. Inside a frame, CSS `vh`/`vw` refer to the *frame*, so use
`calc(N * var(--vh))` to size relative to the screen.

## Rules for plugins

1. **No network, ever.** `fetch`, XHR, WebSocket, remote images, fonts and scripts are all blocked
   by CSP. If you need external data, propose a host provider (a new signal) in an issue.
2. Declare the **minimum** `needs`. Asking for `calendar` or `location` without a clear reason
   gets the PR rejected.
3. Treat every string from a signal as untrusted. Use `textContent` or `ctx.esc()` before
   `innerHTML`.
4. Don't try to navigate, open windows or reach `parent`. A frame that navigates is killed.
5. Keep it light. Backgrounds should hold 30 fps at < 10 % CPU on an M-series MacBook Air. Avoid
   per-frame allocations, and pre-render sprites.
6. Bundled data needs a compatible license, credited in the plugin README **and**
   `THIRD_PARTY_NOTICES.md`.

## Review checklist (maintainers & PR authors)

**Security**
- [ ] `needs` is minimal and justified in the README. Sensitive signals (`calendar`, `location`,
      `nowPlaying`, `claudeUsage`) are explained.
- [ ] `tools/validate.py` passes. Every red-flag warning it prints for this plugin (fetch, eval,
      storage, URLs, navigation, WebRTC, …) is understood and removed.
- [ ] No obfuscated or minified code. `widget.js` is readable source.
- [ ] Untrusted strings are escaped before reaching `innerHTML`.
- [ ] No attempt to fingerprint, beacon, or encode data into navigation or `window.name`.
- [ ] Assets are data only (`.json/.txt/.csv`) and appropriately licensed.

**Quality**
- [ ] README covers what it shows, needs, settings and data sources.
- [ ] Works with `?demo` and with real data. No errors in the problems panel.
- [ ] Respects theme fonts, palette and locale. Japanese and English strings where text is shown.
- [ ] Reasonable CPU/GPU use (check Activity Monitor for the WebKit process).

**Host / provider changes** (Python server, runtime, SDK)
- [ ] No new outbound request without a config switch, documented in `docs/security.md`.
- [ ] `docs/provider-api.md` is updated, and the change stays implementable by the Swift host.
- [ ] Hardening intact: loopback bind, Host/Origin checks, explicit file allow-list, GET only.
- [ ] No personal data (IPs, host names, coordinates, names) in code, examples or screenshots.

## Commit style
[Conventional Commits](https://www.conventionalcommits.org/): `feat(widget-clock): …`,
`fix(server): …`, `docs: …`.


## Library metadata (layout editor)
The editor's library and inspector read these optional manifest keys:

```yaml
category: time | weather | system | dev | life | media
i18n:
  ja:
    name: 時計
    description: 大きな時刻と日付・次の会議
    settings: { size: 文字の大きさ（vh） }          # a label for each setting
    options: { weight: { thin: 細い, regular: 標準 } } # labels for enum values
actions: [music]   # host actions the widget's own buttons may request via ctx.action(type, value)
```

The inspector builds a form from `settings:`: boolean becomes a checkbox, enum a menu, number an input
(with min/max), list a text box, and anything else a text field. Keep settings to things a user would
plausibly change.
