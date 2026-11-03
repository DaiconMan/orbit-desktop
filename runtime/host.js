/* Orbit Desktop host runtime (trusted).
 *
 * - loads the resolved layout from the provider API (/api/config)
 * - renders the background (built-in: color/gradient/image/video, or a plugin frame)
 * - places one sandboxed <iframe> per widget at its anchor
 * - polls / streams provider signals and forwards each one ONLY to frames whose
 *   manifest declared it in `needs:`
 * - shows config problems and plugin errors on screen
 *
 * URL flags:  ?demo  synthesise CPU/network/audio/now-playing so effects can be previewed
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DEMO = new URLSearchParams(location.search).has('demo');
  const DEFAULT_PALETTE = { a: '90,150,255', b: '230,120,200', c: '70,220,200' };
  const frames = [];            // { id, kind, iframe, slot, needs, init, ready, loads, auto }
  const last = {};              // latest value per signal
  const runtimeErrors = [];
  let cfg = null, theme = null, palette = Object.assign({}, DEFAULT_PALETTE);

  const getJSON = async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };
  const cssLen = v => typeof v === 'number' ? v + 'px' : String(v);
  const viewport = () => ({ w: innerWidth, h: innerHeight });

  /* ------------------------------------------------------------ colours / theme */
  function colorTriplet(c) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data; return `${d[0]},${d[1]},${d[2]}`;
  }
  function themeMsg() {
    return Object.assign({}, theme, { palette: Object.assign({}, palette) });
  }
  function broadcastTheme() {
    for (const f of frames) if (f.ready) send(f, { type: 'theme', theme: themeMsg(), viewport: viewport(), scale: f.scale || 1 });
  }
  function paletteFromImage(img) {   // three glow colours sampled from the artwork
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data, out = [];
      for (const [px, py] of [[5, 5], [18, 7], [12, 18]]) {
        let r = 0, gg = 0, b = 0, n = 0;
        for (let y = py - 3; y <= py + 3; y++) for (let x = px - 3; x <= px + 3; x++) { const i = (y * 24 + x) * 4; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
        const m = Math.max(r, gg, b) / n || 1, k = Math.min(2.2, 220 / m);
        out.push(`${Math.min(255, r / n * k) | 0},${Math.min(255, gg / n * k) | 0},${Math.min(255, b / n * k) | 0}`);
      }
      return { a: out[0], b: out[1], c: out[2] };
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------ problems panel */
  function renderProblems() {
    const errs = (cfg ? cfg.errors : []).concat(runtimeErrors);
    // warnings never sit on the desktop: the host app lists them (menu → 設定の警告を表示…); ?debug shows them here
    const warns = cfg && location.search.includes('debug') ? cfg.warnings : [];
    const el = $('problems');
    if (!errs.length && !warns.length) { el.hidden = true; return; }
    el.hidden = false; el.classList.toggle('only-warn', !errs.length);
    el.textContent = '';
    const h = document.createElement('h1'); h.textContent = errs.length ? 'Orbit Desktop · configuration problems' : 'Orbit Desktop · warnings';
    const ul = document.createElement('ul');
    for (const e of errs.slice(0, 14)) { const li = document.createElement('li'); li.textContent = e; ul.appendChild(li); }
    for (const w of warns.slice(0, 6)) { const li = document.createElement('li'); li.className = 'warn'; li.textContent = w; ul.appendChild(li); }
    const s = document.createElement('small'); s.textContent = cfg ? `config: ${cfg.configPath} — fix the file and the desktop reloads automatically` : '';
    el.append(h, ul, s);
  }
  const bootAt = Date.now();
  setTimeout(renderProblems, 20500);

  /* ------------------------------------------------------------ frames */
  const assetCache = {};
  function loadAssets(pluginId, list) {
    if (!list || !list.length) return Promise.resolve({});
    return assetCache[pluginId] = assetCache[pluginId] || Promise.all(list.map(async a => {
      const r = await fetch(`/plugins/${pluginId}/assets/${a}`, { cache: 'force-cache' });
      if (!r.ok) throw new Error(`asset ${a}: ${r.status}`);
      return [a, a.endsWith('.json') ? await r.json() : await r.text()];
    })).then(Object.fromEntries);
  }
  function send(f, msg) {
    // '*' is unavoidable for an opaque-origin (sandboxed) frame; we address the exact contentWindow,
    // and a frame that navigates away is destroyed on its second 'load' event (see docs/security.md).
    if (f.dead || !f.iframe.contentWindow) return;
    f.iframe.contentWindow.postMessage(Object.assign({ orbit: 1 }, msg), '*');
  }
  function kill(f, why) {
    f.dead = true; f.iframe.remove();
    runtimeErrors.push(`${f.id}: ${why} — plugin stopped`); renderProblems();
  }
  function makeFrame(spec, parent) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');               // opaque origin, no forms/popups/top-navigation
    iframe.setAttribute('allow', '');                               // no camera/mic/geolocation/etc.
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('tabindex', '-1'); iframe.setAttribute('aria-hidden', 'true');
    iframe.title = spec.id;
    const f = Object.assign({ iframe, ready: false, loads: 0, dead: false }, spec);
    iframe.addEventListener('load', () => { if (++f.loads > 1) kill(f, 'frame navigated away from its document'); });
    iframe.src = `/frame/${encodeURIComponent(spec.id)}`;
    parent.appendChild(iframe);
    frames.push(f);
    return f;
  }
  addEventListener('message', async e => {
    const f = frames.find(x => !x.dead && x.iframe.contentWindow === e.source);
    if (!f || e.origin !== 'null') return;                          // only our sandboxed frames
    const m = e.data;
    if (!m || m.orbit !== 1) return;
    if (m.type === 'ready') {
      let assets = {};
      try { assets = await loadAssets(f.id, f.assets); } catch (err) { runtimeErrors.push(`${f.id}: ${err.message}`); renderProblems(); }
      send(f, Object.assign({ type: 'init', theme: themeMsg(), viewport: viewport(), assets, scale: f.scale || 1 }, f.init));
      f.ready = true;
      for (const n of f.needs) if (last[n] !== undefined) send(f, { type: 'signal', name: n, data: last[n] });
    } else if (m.type === 'size' && f.auto) {
      const w = Math.max(0, Math.min(+m.w || 0, innerWidth)), h = Math.max(0, Math.min(+m.h || 0, innerHeight));
      if (f.auto.width) f.iframe.style.width = w + 'px';
      if (f.auto.height) f.iframe.style.height = h + 'px';
      f.slot.classList.remove('pending');
      f.slot.classList.toggle('empty', !!f.zoned && h < 2);   // nothing to show: collapse inside a zone
      layoutChanged();
    } else if (m.type === 'visible') {
      f.slot.classList.toggle('off', !m.on);
      layoutChanged();
    } else if (m.type === 'error') {
      const msg = `${f.id}: ${String(m.message).slice(0, 300)}`;
      if (!runtimeErrors.includes(msg) && runtimeErrors.length < 20) { runtimeErrors.push(msg); renderProblems(); }
      console.warn('[orbit plugin]', msg);
    }
  });

  /* ------------------------------------------------------------ background */
  function renderBackground(bg) {
    const el = $('bg'); el.textContent = '';
    if (!bg) return;
    const s = bg.settings || {};
    if (bg.use === 'color') el.style.background = s.color;
    else if (bg.use === 'gradient') {
      el.style.background = s.style === 'radial' ? `radial-gradient(circle at 50% 50%, ${s.stops.join(', ')})` : `linear-gradient(${s.angle}deg, ${s.stops.join(', ')})`;
    } else if (bg.use === 'image' || bg.use === 'video') {
      el.style.background = s.color;
      const m = document.createElement(bg.use === 'image' ? 'img' : 'video');
      m.src = '/media/background'; m.style.objectFit = s.fit; m.style.opacity = s.opacity;
      if (s.blur) { m.style.filter = `blur(${s.blur}px)`; m.style.transform = 'scale(1.05)'; }
      if (bg.use === 'video') {
        Object.assign(m, { muted: true, loop: true, autoplay: true, playsInline: true });
        m.addEventListener('loadedmetadata', () => { m.playbackRate = s.playback_rate; m.play().catch(() => {}); });
      } else m.alt = '';
      el.appendChild(m);
    } else if (!bg.builtin) {
      el.style.background = '#04050a';
      makeFrame({ id: bg.use, kind: 'background', needs: bg.needs, assets: bg.assets, slot: el, auto: null,
        init: { settings: bg.settings, needs: bg.needs, react: bg.react, hooks: bg.hooks } }, el);
    }
  }

  /* ------------------------------------------------------------ widgets */
  function place(slot, p) {
    const [v, h] = p.anchor === 'center' ? ['center', 'center'] : p.anchor.split('-');
    const x = cssLen(p.x), y = cssLen(p.y), s = slot.style, tf = [];
    if (h === 'left') s.left = x; else if (h === 'right') s.right = x; else { s.left = `calc(50% + ${x})`; tf.push('translateX(-50%)'); }
    if (v === 'top') s.top = y; else if (v === 'bottom') s.bottom = y; else { s.top = `calc(50% + ${y})`; tf.push('translateY(-50%)'); }
    if (tf.length) s.transform = tf.join(' ');
    s.zIndex = 10 + (p.z || 0);
  }
  /* zones: widgets flow vertically inside a zone (no overlaps); a zone with rotate_seconds holds pages of
     columns that crossfade. Hidden or empty widgets collapse; pages with nothing visible are skipped. */
  const zoneEls = {};
  function renderZones(zones) {
    const host = $('widgets');
    for (const [name, z] of Object.entries(zones || {})) {
      const el = document.createElement('div'); el.className = 'zone'; el.dataset.zone = name;
      const paged = !!z.rotate_seconds;
      if (paged) el.classList.add('paged');
      el.style.setProperty('--cols', z.columns);
      host.appendChild(el);
      zoneEls[name] = { el, z, paged, pages: [], cur: 0, dots: null };
      styleZone(zoneEls[name]);
    }
  }
  // sizes of a zone scale with its `scale` (HUD editor); its widgets get the same scale for their units
  const scaled = (v, k) => k === 1 ? cssLen(v) : `calc(${cssLen(v)} * ${k})`;
  function styleZone(Z) {
    const z = Z.z, k = z.scale || 1, el = Z.el;
    for (const p of ['left', 'right', 'top', 'bottom', 'transform']) el.style[p] = '';
    place(el, z); el.style.zIndex = 10;
    el.style.width = scaled(z.width, k);
    el.style.setProperty('--gap', scaled(z.gap, k));
    el.style.setProperty('--colgap', scaled(z.column_gap, k));
    if (Z.paged) el.style.height = scaled(z.height === 'auto' ? '40vh' : z.height, k);
  }
  function zoneColumn(name, page, column) {
    const Z = zoneEls[name];
    while (Z.pages.length <= page) {
      const p = document.createElement('div'); p.className = 'page';
      for (let c = 0; c < Z.z.columns; c++) { const col = document.createElement('div'); col.className = 'col'; p.appendChild(col); }
      Z.el.appendChild(p); Z.pages.push(p);
    }
    return Z.pages[page].children[column];
  }
  const pageVisible = p => [...p.querySelectorAll('.slot')].some(s => !s.classList.contains('off') && !s.classList.contains('empty'));
  function showPage(Z, i) {
    Z.cur = i;
    Z.pages.forEach((p, k) => p.classList.toggle('on', k === i));
    if (Z.dots) [...Z.dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
  }
  function startRotation() {
    for (const Z of Object.values(zoneEls)) {
      if (!Z.paged || !Z.pages.length) continue;
      const start = (+new URLSearchParams(location.search).get('page') || 0) % Z.pages.length;   // ?page=N starts on page N
      if (Z.pages.length > 1) {
        Z.dots = document.createElement('div'); Z.dots.className = 'dots';
        Z.pages.forEach(() => Z.dots.appendChild(document.createElement('i')));
        Z.el.appendChild(Z.dots);
      }
      showPage(Z, start);
      setInterval(() => {
        for (let k = 1; k <= Z.pages.length; k++) {
          const n = (Z.cur + k) % Z.pages.length;
          if (pageVisible(Z.pages[n]) || k === Z.pages.length) { showPage(Z, n); break; }
        }
      }, Z.z.rotate_seconds * 1000);
    }
  }
  let layoutTimer = null;
  function layoutChanged() {   // dots for pages that have nothing visible are hidden
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      for (const Z of Object.values(zoneEls)) if (Z.dots) Z.pages.forEach((p, k) => { Z.dots.children[k].hidden = !pageVisible(p); });
    }, 300);
  }

  function renderWidgets(list) {
    const host = $('widgets');
    for (const w of list) {
      const zoned = !!(w.zone && zoneEls[w.zone]);
      const slot = document.createElement('div'); slot.className = 'slot pending'; slot.dataset.widget = w.use;
      if (w.dim === false) slot.classList.add('nodim');
      if (zoned) {
        slot.classList.add('inzone');
        const Z = zoneEls[w.zone];
        (Z.paged ? zoneColumn(w.zone, w.page, w.column) : Z.el).appendChild(slot);
        const colW = Math.round(slot.getBoundingClientRect().width) || Math.round(innerWidth * .3);
        const f = makeFrame({ id: w.use, kind: 'widget', needs: w.needs, assets: w.assets, slot, zoned: true, zone: w.zone, scale: Z.z.scale || 1, auto: { width: false, height: true },
          init: { settings: w.settings, needs: w.needs, sizing: { width: 'zone', height: 'auto' }, maxWidth: colW } }, slot);
        f.iframe.style.width = '100%'; f.iframe.style.height = '10px';
        continue;
      }
      place(slot, w.position); host.appendChild(slot);
      const auto = { width: w.position.width === 'auto', height: w.position.height === 'auto' };
      const f = makeFrame({ id: w.use, kind: 'widget', needs: w.needs, assets: w.assets, slot, auto, scale: w.scale || 1, w,
        init: { settings: w.settings, needs: w.needs, sizing: { width: w.position.width, height: w.position.height }, maxWidth: Math.round(innerWidth * .9) } }, slot);
      f.iframe.style.width = auto.width ? Math.round(innerWidth * .9) + 'px' : scaled(w.position.width, w.scale || 1);
      f.iframe.style.height = auto.height ? '10px' : cssLen(w.position.height);
      if (!auto.width && !auto.height) slot.classList.remove('pending');
    }
  }

  /* ------------------------------------------------------------ signals */
  function publish(name, data) {
    last[name] = data;
    if (name === 'alerts') onAlerts(data);
    for (const f of frames) if (f.ready && !f.dead && f.needs.includes(name)) send(f, { type: 'signal', name, data });
  }
  /* alerts: dim everything else while an EEW / tsunami warning is shown, and flash a red glow around the
     whole screen once per new (not cancelled) EEW, like the prototype. Widgets can't draw outside their frame. */
  let edgeFor = '';
  function onAlerts(a) {
    document.body.classList.toggle('alerting', !!(a && (a.eew || a.tsunami)));
    const e = a && a.eew;
    if (e && !e.cancelled && e.id && e.id !== edgeFor) {
      edgeFor = e.id;
      const ed = $('edge'); ed.classList.remove('go'); void ed.offsetWidth; ed.classList.add('go');
    }
  }
  const needed = () => new Set(frames.flatMap(f => f.needs));
  function every(ms, fn) { fn(); return setInterval(fn, ms); }
  // Slow signals: poll every `ms`, but until the host has a first value (it may still be
  // fetching right after start-up) retry every 5 s instead of leaving the widget empty.
  function slowPoll(ms, path, name) {
    let have = false;
    const tick = async () => { try { const v = await getJSON(path); if (v) { have = true; publish(name, v); } } catch (e) {} };
    const warm = setInterval(() => { if (have) clearInterval(warm); else tick(); }, 5000);
    return every(ms, tick);
  }

  let artKey = null, artURL = null;
  async function pollNowPlaying() {
    let np;
    try { np = await getJSON('/api/signals/now-playing'); } catch (e) { np = { state: 'stopped' }; }
    if (DEMO && np.state !== 'playing') np = demoTrack();
    np.recv = Date.now();
    const on = np.state === 'playing' || np.state === 'paused';
    if (on && np.hasArt && np.key !== artKey) {
      artKey = np.key;
      try {
        const blob = await (await fetch('/api/signals/artwork?k=' + encodeURIComponent(np.key), { cache: 'no-store' })).blob();
        const bmp = await createImageBitmap(blob);
        const S = 600, c = document.createElement('canvas'), k = Math.min(1, S / Math.max(bmp.width, bmp.height));
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        artURL = c.toDataURL('image/jpeg', .88);                    // frames only accept data: images
        if (theme.accent === 'auto') { const p = paletteFromImage(c); if (p) { palette = p; broadcastTheme(); } }
      } catch (e) { artURL = null; }
    }
    if (!on && artKey !== null) { artKey = null; artURL = null; if (theme.accent === 'auto') { palette = Object.assign({}, DEFAULT_PALETTE); broadcastTheme(); } }
    publish('nowPlaying', Object.assign({}, np, { artwork: on ? artURL : null }));
  }

  let demoStart = Date.now();
  function demoTrack() { return { state: 'playing', source: 'demo', key: 'demo', title: 'Demo Track', artist: 'Orbit Desktop', album: '?demo mode', position: ((Date.now() - demoStart) / 1000) % 240, duration: 240, hasArt: false }; }
  function demoSystem(s) {
    const ph = (Date.now() / 20000) % 1, v = ph < .5 ? ph * 2 : 2 - ph * 2;   // sweep 0 -> 100% -> 0 every 20 s
    return Object.assign({}, s, { cpu: v * 100, net: { rx: Math.pow(10, 4 + v * 3.7) * .7, tx: Math.pow(10, 4 + v * 3.7) * .3 } });
  }
  function startAudio() {
    if (DEMO) {
      setInterval(() => {
        const tt = Date.now() / 1000, beat = Math.max(0, Math.sin(tt * 2 * Math.PI * 2)) ** 8;
        publish('audio', { level: .05 * beat + .01, bass: .05 * beat + .005, mid: .01, high: .002 * Math.random(),
          bands: Array.from({ length: 16 }, (_, i) => (i < 3 ? beat * .05 : .01 * (1 + Math.sin(tt * 1.3 + i * .7)) / (1 + i * .15))) });
      }, 50);
      return;
    }
    const es = new EventSource('/api/stream/audio');
    es.onmessage = e => { try { publish('audio', JSON.parse(e.data)); } catch (_) {} };
  }
  function startSignals() {
    const n = needed(), p = cfg.providers;
    if (n.has('time')) every(1000, () => publish('time', { now: Date.now(), locale: theme.locale, hour12: theme.hour12, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    if (n.has('system')) every(2000, async () => { try { let s = await getJSON('/api/signals/system'); if (DEMO) s = demoSystem(s); publish('system', s); } catch (e) {} });
    if (n.has('nowPlaying') && (p.nowPlaying || DEMO)) every(2000, pollNowPlaying);
    if (n.has('calendar')) every(30000, async () => { try { publish('calendar', await getJSON('/api/signals/calendar')); } catch (e) {} });
    if (n.has('weather') && p.weather) slowPoll(60000, '/api/signals/weather', 'weather');
    if (n.has('location')) slowPoll(60000, '/api/signals/location', 'location');
    if (n.has('claudeUsage') && p.claudeUsage) slowPoll(30000, '/api/signals/claude-usage', 'claudeUsage');
    if (n.has('audio')) startAudio();
    for (const [name, sg] of Object.entries(cfg.signals || {})) if (n.has(name)) slowPoll(sg.interval, sg.path, name);
  }
  function nightDim() {   // theme.night_dim: 00:00-06:00 every dimmable widget settles to ~65 %
    if (!theme.night_dim) return;
    const tick = () => $('widgets').classList.toggle('calm', new Date().getHours() < 6);
    tick(); setInterval(tick, 60000);
  }

  /* ------------------------------------------------------------ HUD layout editor
     Entered from the host app's menu (window.orbitEdit(true)): every zone and fixed widget gets a frame that
     can be dragged (move), resized from the corner (scale), and, for zones, widened / heightened from the edges.
     Widgets can be hidden. "保存" sends the overrides to the host app (WKScriptMessageHandler `orbit`), which
     writes ~/.config/orbit-desktop/settings.json; layout.yaml itself is never rewritten. */
  const ED = { on: false, items: [], hidden: new Set(), reset: new Set(), changed: new Set(), grid: true, sel: null, layer: null };
  const vw = px => px / innerWidth * 100, vh = px => px / innerHeight * 100;
  const snapV = (v, step) => Math.round(v / step) * step;
  function offsetsFor(anchor, r) {       // element rect -> {x, y} offsets for its anchor (vw / vh strings)
    const [v, h] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
    const W = innerWidth, H = innerHeight;
    const x = h === 'left' ? r.left : h === 'right' ? W - r.right : r.left + r.width / 2 - W / 2;
    const y = v === 'top' ? r.top : v === 'bottom' ? H - r.bottom : r.top + r.height / 2 - H / 2;
    return { x: vw(x).toFixed(2) + 'vw', y: vh(y).toFixed(2) + 'vh' };
  }
  function edItems() {
    const items = [];
    const byZone = {};
    for (const w of cfg.widgets) if (w.zone) (byZone[w.zone] = byZone[w.zone] || []).push(w);
    for (const [name, Z] of Object.entries(zoneEls)) {
      const uses = [...new Map((byZone[name] || []).map(w => [w.use, w.name])).entries()];
      items.push({ key: 'zone:' + name, kind: 'zone', Z, el: Z.el, label: name, uses,
        spec: { anchor: Z.z.anchor, x: Z.z.x, y: Z.z.y, width: Z.z.width, height: Z.z.height, scale: Z.z.scale || 1 }, base: Z.z.base });
    }
    for (const f of frames) if (f.kind === 'widget' && f.w && !f.dead && f.w.dim !== false) {   // dim:false = overlays (alerts)
      const p = f.w.position;
      items.push({ key: 'widget:' + f.id, kind: 'widget', f, el: f.slot, label: f.w.name || f.id, use: f.id,
        spec: { anchor: p.anchor, x: p.x, y: p.y, width: p.width, scale: f.scale || 1 }, base: f.w.base });
    }
    return items;
  }
  function edApply(it) {
    const sp = it.spec;
    if (it.kind === 'zone') {
      Object.assign(it.Z.z, sp); styleZone(it.Z);
      for (const f of frames) if (f.zone === it.Z.el.dataset.zone) { f.scale = sp.scale; if (f.ready) send(f, { type: 'theme', theme: themeMsg(), viewport: viewport(), scale: f.scale }); }
    } else {
      const s = it.el.style; for (const p of ['left', 'right', 'top', 'bottom', 'transform']) s[p] = '';
      place(it.el, sp);
      it.f.scale = sp.scale;
      if (sp.width !== 'auto') it.f.iframe.style.width = scaled(sp.width, sp.scale);
      if (it.f.ready) send(it.f, { type: 'theme', theme: themeMsg(), viewport: viewport(), scale: it.f.scale });
    }
  }
  function edSync() {
    for (const it of ED.items) {
      const r = it.el.getBoundingClientRect(), b = it.box;
      const w = Math.max(r.width, 140), h = Math.max(r.height, 44);
      Object.assign(b.style, { left: r.left + 'px', top: r.top + 'px', width: w + 'px', height: h + 'px' });
      b.querySelector('.ed-size').textContent = Math.round(it.spec.scale * 100) + '%';
      b.classList.toggle('hidden', !!it.use && ED.hidden.has(it.use));
      b.classList.toggle('sel', ED.sel === it);
    }
  }
  function edDrag(e, it, mode) {
    e.preventDefault(); e.stopPropagation();
    ED.sel = it;
    const r0 = it.el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, sp0 = Object.assign({}, it.spec);
    const W0 = r0.width || 140, H0 = r0.height || 44;
    const move = ev => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0, g = ED.grid && !ev.altKey;
      if (mode === 'move') {
        let left = r0.left + dx, top = r0.top + dy;
        if (g) { left = snapV(vw(left), .5) / 100 * innerWidth; top = snapV(vh(top), .5) / 100 * innerHeight; }
        const r = { left, top, width: r0.width, height: r0.height, right: left + r0.width, bottom: top + r0.height };
        Object.assign(it.spec, offsetsFor(it.spec.anchor, r));
      } else if (mode === 'scale') {
        let k = sp0.scale * Math.max(.2, (W0 + dx) / W0);
        k = Math.min(2.5, Math.max(.5, g ? snapV(k, .05) : k));
        it.spec.scale = +k.toFixed(3);
      } else if (mode === 'width') {
        let v = vw(Math.max(60, W0 + dx)) / sp0.scale; if (g) v = snapV(v, .5);
        it.spec.width = v.toFixed(1) + 'vw';
      } else if (mode === 'height') {
        let v = vh(Math.max(40, H0 + dy)) / sp0.scale; if (g) v = snapV(v, .5);
        it.spec.height = v.toFixed(1) + 'vh';
      }
      ED.changed.add(it.key); ED.reset.delete(it.key);
      edApply(it); edSync();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); edSync(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  function edToggleHide(use) {
    if (ED.hidden.has(use)) ED.hidden.delete(use); else ED.hidden.add(use);
    for (const f of frames) if (f.id === use && f.slot) f.slot.classList.toggle('ed-hidden', ED.hidden.has(use));
    edRender();
  }
  function edRender() {
    const L = ED.layer;
    L.querySelectorAll('.ed-box').forEach(b => b.remove());
    for (const it of ED.items) {
      const b = document.createElement('div'); b.className = 'ed-box ' + it.kind; it.box = b;
      const head = document.createElement('div'); head.className = 'ed-head';
      const name = document.createElement('b'); name.textContent = it.kind === 'zone' ? 'ZONE ' + it.label.toUpperCase() : it.label;
      const size = document.createElement('span'); size.className = 'ed-size';
      head.append(name, size);
      const tools = document.createElement('span'); tools.className = 'ed-tools';
      const rs = document.createElement('i'); rs.textContent = '↺'; rs.title = '元に戻す';
      rs.onpointerdown = ev => { ev.stopPropagation(); it.spec = Object.assign({}, it.base); ED.reset.add(it.key); ED.changed.delete(it.key); edApply(it); edSync(); };
      tools.appendChild(rs);
      if (it.use) {
        const x = document.createElement('i'); x.textContent = ED.hidden.has(it.use) ? '表示' : '×'; x.title = '表示 / 非表示';
        x.onpointerdown = ev => { ev.stopPropagation(); edToggleHide(it.use); };
        tools.appendChild(x);
      }
      head.appendChild(tools);
      b.appendChild(head);
      if (it.kind === 'zone') {            // the zone's modules: click to hide / show
        const list = document.createElement('div'); list.className = 'ed-mods';
        for (const [use, label] of it.uses) {
          const c = document.createElement('span'); c.textContent = label || use;
          c.classList.toggle('off', ED.hidden.has(use));
          c.onpointerdown = ev => { ev.stopPropagation(); edToggleHide(use); };
          list.appendChild(c);
        }
        b.appendChild(list);
      }
      b.onpointerdown = ev => edDrag(ev, it, 'move');
      const hs = [['ed-h-scale', 'scale']];
      if (it.kind === 'zone') { hs.push(['ed-h-width', 'width']); if (it.Z.paged) hs.push(['ed-h-height', 'height']); }
      for (const [cls, mode] of hs) { const h = document.createElement('div'); h.className = 'ed-h ' + cls; h.onpointerdown = ev => edDrag(ev, it, mode); b.appendChild(h); }
      L.appendChild(b);
    }
    // hidden modules that are not on screen at all (hidden before): chips to bring them back
    const tray = L.querySelector('.ed-tray'); tray.textContent = '';
    const offscreen = [...ED.hidden].filter(u => !frames.some(f => f.id === u));
    if (offscreen.length) {
      const t = document.createElement('span'); t.textContent = '非表示:'; tray.appendChild(t);
      for (const u of offscreen) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = u; c.onclick = () => { ED.hidden.delete(u); edRender(); }; tray.appendChild(c); }
    }
    edSync();
  }
  function edToHost(msg) {
    try { window.webkit.messageHandlers.orbit.postMessage(msg); return true; } catch (e) { return false; }
  }
  function edSave() {
    const layout = Object.assign({}, cfg.layoutOverrides || {});
    for (const k of ED.reset) delete layout[k];
    for (const it of ED.items) if (ED.changed.has(it.key)) {
      const o = {}, sp = it.spec, base = it.base || {};
      for (const k of ['anchor', 'x', 'y', 'width', 'height', 'scale']) if (sp[k] !== undefined && sp[k] !== null && (k === 'scale' || String(sp[k]) !== String(base[k]))) o[k] = sp[k];
      if (o.scale === 1 && Object.keys(o).length === 1) delete layout[it.key]; else layout[it.key] = o;
    }
    if (!edToHost({ type: 'saveLayout', layout, hidden: [...ED.hidden].sort() })) alert('保存できません（Orbit Desktop.app の中でのみ保存できます）');
  }
  function orbitEdit(on) {
    if (on === ED.on || !cfg) return;
    ED.on = on;
    document.body.classList.toggle('editing', on);
    if (!on) { location.reload(); return; }
    ED.hidden = new Set(cfg.hidden || []); ED.changed.clear(); ED.reset.clear(); ED.sel = null;
    const L = ED.layer = document.createElement('div'); L.id = 'editor'; L.classList.toggle('grid', ED.grid);
    const bar = document.createElement('div'); bar.className = 'ed-bar';
    bar.innerHTML = '<b>HUD レイアウト</b><span>ドラッグで移動 · 右下でサイズ · ゾーンは右端で幅 / 下端で高さ · ⌥ でグリッド無視</span>';
    const btn = (label, fn, cls = '') => { const x = document.createElement('button'); x.textContent = label; x.className = cls; x.onclick = fn; bar.appendChild(x); return x; };
    btn('グリッド', () => { ED.grid = !ED.grid; L.classList.toggle('grid', ED.grid); });
    btn('すべて初期配置に', () => { for (const it of ED.items) { it.spec = Object.assign({}, it.base); ED.reset.add(it.key); ED.changed.delete(it.key); edApply(it); } edSync(); });
    btn('キャンセル', () => { if (!edToHost({ type: 'exitEdit' })) orbitEdit(false); });
    btn('保存', edSave, 'primary');
    const tray = document.createElement('div'); tray.className = 'ed-tray';
    L.append(bar, tray);
    document.body.appendChild(L);
    ED.items = edItems();
    edRender();
    ED.timer = setInterval(edSync, 500);   // follow content that resizes while editing
  }
  window.orbitEdit = orbitEdit;
  addEventListener('keydown', e => {
    if (!ED.on) return;
    if (e.key === 'Escape') { if (!edToHost({ type: 'exitEdit' })) orbitEdit(false); }
    else if (e.key === 'Enter') edSave();
    else if (ED.sel && e.key.startsWith('Arrow')) {        // nudge the selected element by 0.1 vw / vh
      const it = ED.sel, r = it.el.getBoundingClientRect(), d = e.shiftKey ? 1 : .1;
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      const left = r.left + dx * innerWidth / 100, top = r.top + dy * innerHeight / 100;
      Object.assign(it.spec, offsetsFor(it.spec.anchor, { left, top, width: r.width, height: r.height, right: left + r.width, bottom: top + r.height }));
      ED.changed.add(it.key); edApply(it); edSync(); e.preventDefault();
    }
  });

  /* ------------------------------------------------------------ boot */
  async function boot() {
    try { cfg = await getJSON('/api/config'); }
    catch (e) { cfg = null; runtimeErrors.push('cannot reach the Orbit provider API (' + e.message + ') — is the dev server running?'); renderProblems(); setTimeout(() => location.reload(), 10000); return; }
    theme = Object.assign({}, cfg.theme);
    if (theme.locale === 'auto') theme.locale = navigator.language || 'en-US';
    if (theme.accent !== 'auto') palette.c = colorTriplet(theme.accent);
    const rs = document.documentElement.style;
    rs.setProperty('--font', theme.font); rs.setProperty('--mono', theme.mono_font); rs.setProperty('--fg', theme.text_color);
    renderBackground(cfg.background);
    renderZones(cfg.zones);
    renderWidgets(cfg.widgets);
    startRotation();
    nightDim();
    renderProblems();
    startSignals();
    addEventListener('resize', broadcastTheme);
    setInterval(async () => {                                     // live-reload on layout.yaml / manifest change
      try { const v = await getJSON('/api/config/version'); if (v.version !== cfg.version) location.reload(); } catch (e) {}
    }, 5000);
  }
  boot();
})();
