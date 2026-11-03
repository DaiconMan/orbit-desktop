# AGENTS.md: building Orbit Desktop widgets with an AI agent

You are writing a widget for Orbit Desktop, a macOS live wallpaper made of sandboxed plugins. Follow these
steps exactly. Everything you need is in this repository; no network access is required.

## Read first (in this order)
1. `docs/widgets.md`: the guide (manifest, code, look, rules)
2. `runtime/sdk/orbit-sdk.d.ts`: the whole API surface (`Orbit.widget`, `ctx`, `Orbit.module`, `Orbit.ui`)
3. `schemas/signals/index.json`, then the `schemas/signals/<name>.schema.json` of each signal you use, and its
   sample `examples/mock/<name>.json`
4. `schemas/widget.schema.json`: the manifest
5. One bundled widget close to yours, as a style reference: `widgets/load` (rows + sparklines), `widgets/weather`,
   `widgets/mac` (tiles), `widgets/week` (lists), `widgets/power` (big number + chips)

## Steps
1. Scaffold: `python3 tools/new-widget.py <id> --name "<Name>" --needs <a,b> --category <time|weather|system|dev|life|media> [--ja-name <名前>]`
2. Edit `widgets/<id>/widget.js`, `style.css`, `widget.yaml` (settings + `i18n.ja`), and `README.md`.
3. Check: `python3 tools/validate.py` must print `OK`. For JS syntax on macOS:
   `osascript -l JavaScript -e "new Function(\$.NSString.stringWithContentsOfFileEncodingError('widgets/<id>/widget.js',4,null).js); 'ok'"`
4. Look at it: `python3 tools/dev-widget.py <id> --shot /tmp/<id>.png`, then open the PNG. Fake conditions with
   `--mock <file>` (same format as `examples/mock/all.json`) and test empty / missing data.
5. Iterate until it looks like the bundled widgets. Then report the files and the screenshot.

If `python3` / `swift` fail with an Xcode license message, prefix `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.

## Hard rules
* Read data only from `ctx.signals` / `on.<signal>` handlers for signals listed in `needs:`. There is no network
  (`fetch`, XHR, WebSocket, image URLs), no `localStorage`, no `eval` / `new Function`, no `window.open`, no navigation.
  The validator flags them; the sandbox blocks them anyway.
* Escape every string from a signal: `Orbit.ui.esc()` or `textContent`.
* Sizes in host units: `calc(var(--vh) * n)` / `calc(var(--vw) * n)`. Never plain `vh` / `vw` in a frame.
* Use `Orbit.module(ctx, 'TITLE')` and the SDK classes (`.kv`, `.row`, `.tiles`/`.tile`, `.meter`, `.lst`, `.big`,
  `.foot`, `.warn`, `.ok`) and tokens (`--t-xs … --t-hero`, `rgb(var(--c))`). Look: dark, calm, minimal; thin
  numbers; small spaced monospace labels; no bright fills, no blinking, no wobble.
* `ctx.visible(false)` when there is nothing to show.
* No personal data or hard-coded hosts, names or locations. Settings or signals only.
* Re-render on updates only; no animation loops in widgets.
* Japanese first (`i18n.ja`); English strings may live in the code for `ctx.lang !== 'ja'`.

## Done means
* `tools/validate.py` → OK
* a screenshot from `dev-widget.py --shot` that looks consistent with the other widgets
* README.md lists what it shows, `needs`, settings and any caveats
