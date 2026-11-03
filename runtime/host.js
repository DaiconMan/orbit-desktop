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
  const runtimeErrors = [];     // shown on the desktop (config / security problems)
  const pluginErrors = [];      // widget runtime errors: host app menu, or on screen with ?debug
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
    const errs = (cfg ? cfg.errors : []).concat(runtimeErrors, location.search.includes('debug') ? pluginErrors : []);
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
      if (f.fill) fitFill(f, h);
      layoutChanged();
    } else if (m.type === 'visible') {
      f.slot.classList.toggle('off', !m.on);
      layoutChanged();
    } else if (m.type === 'error') {
      // a widget's own runtime error is not a desktop-wide problem: log it and let the host app list it
      // (menu → 設定の警告を表示…); ?debug also shows it on screen
      const msg = `${f.id}: ${String(m.message).slice(0, 300)}`;
      console.warn('[orbit plugin]', msg);
      if (!pluginErrors.includes(msg) && pluginErrors.length < 20) {
        pluginErrors.push(msg);
        try { window.webkit.messageHandlers.orbit.postMessage({ type: 'pluginError', message: msg }); } catch (_) {}
        if (location.search.includes('debug')) renderProblems();
      }
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
  function zoneFill(name, page) {       // full-width row at the top of a page (widgets with fill: true)
    zoneColumn(name, page, 0);
    const p = zoneEls[name].pages[page];
    let c = p.querySelector(':scope > .col.fill');
    if (!c) { c = document.createElement('div'); c.className = 'col fill'; p.insertBefore(c, p.firstChild); }
    return c;
  }
  // fill: grow / shrink the frame's units until its content just fits the zone height (a few iterations)
  function fitFill(f, h) {
    const Z = zoneEls[f.zone]; if (!Z || !Z.paged || h < 2) return;
    const H = Z.el.clientHeight * .94, target = Math.min(3, Math.max(.4, f.scale * H / h));
    if (Math.abs(target / f.scale - 1) < .04 || (f.fitIters = (f.fitIters || 0) + 1) > 6) return;
    f.scale = +target.toFixed(3);
    if (f.ready) send(f, { type: 'theme', theme: themeMsg(), viewport: viewport(), scale: f.scale });
  }
  const pageVisible = p => [...p.querySelectorAll('.slot')].some(s => !s.classList.contains('off') && !s.classList.contains('empty'));
  function showPage(Z, i) {
    Z.cur = i;
    Z.pages.forEach((p, k) => p.classList.toggle('on', k === i));
    if (Z.dots) [...Z.dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
  }
  const rotTimers = [];
  let rotationPaused = false;   // the editor flips pages itself
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
      rotTimers.push(setInterval(() => {
        if (rotationPaused) return;
        for (let k = 1; k <= Z.pages.length; k++) {
          const n = (Z.cur + k) % Z.pages.length;
          if (pageVisible(Z.pages[n]) || k === Z.pages.length) { showPage(Z, n); break; }
        }
      }, Z.z.rotate_seconds * 1000));
    }
  }
  /* pages of free widgets: every widget with `page: N` belongs to page group N; groups crossfade every
     cfg.pageSeconds, widgets without a page are always shown. */
  const FP = { pages: [], cur: null, dots: null };
  const pagedSlots = () => [...document.querySelectorAll('#widgets > .slot.paged')];
  function showFreePage(p) {           // p = page number, or null = only the always-shown widgets
    FP.cur = p;
    for (const s of pagedSlots()) s.classList.toggle('pg-off', +s.dataset.page !== p);
    if (FP.dots) [...FP.dots.children].forEach((d, k) => d.classList.toggle('on', FP.pages[k] === p));
  }
  function startFreePages() {
    FP.pages = [...new Set(pagedSlots().map(s => +s.dataset.page))].sort((a, b) => a - b);
    if (FP.dots) { FP.dots.remove(); FP.dots = null; }
    if (!FP.pages.length) return;
    const q = +new URLSearchParams(location.search).get('page') || 0;
    showFreePage(FP.pages[q % FP.pages.length]);
    if (FP.pages.length > 1) {
      FP.dots = document.createElement('div'); FP.dots.className = 'pagedots';
      FP.pages.forEach(() => FP.dots.appendChild(document.createElement('i')));
      $('widgets').appendChild(FP.dots);
      setTimeout(placeDots, 3000);
      showFreePage(FP.cur);
    }
    const visible = p => pagedSlots().some(s => +s.dataset.page === p && !s.classList.contains('off') && !s.classList.contains('empty'));
    rotTimers.push(setInterval(() => {
      if (rotationPaused) return;
      const i = FP.pages.indexOf(FP.cur);
      for (let k = 1; k <= FP.pages.length; k++) {
        const n = FP.pages[(i + k) % FP.pages.length];
        if (visible(n) || k === FP.pages.length) { showFreePage(n); break; }
      }
    }, (cfg.pageSeconds || 30) * 1000));
  }
  function placeDots() {               // under the area the page groups use, at its left edge
    if (!FP.dots) return;
    let l = Infinity, b = 0;
    for (const s of pagedSlots()) { const r = s.getBoundingClientRect(); if (r.height > 1) { l = Math.min(l, r.left); b = Math.max(b, r.bottom); } }
    if (l === Infinity) return;
    Object.assign(FP.dots.style, { left: l + 'px', top: Math.min(innerHeight - 20, b + innerHeight * .012) + 'px' });
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
    list.forEach((w, idx) => {
      const zoned = !!(w.zone && zoneEls[w.zone]);
      const slot = document.createElement('div'); slot.className = 'slot pending'; slot.dataset.widget = w.use; slot.dataset.idx = idx;
      if (w.dim === false) slot.classList.add('nodim');
      if (zoned) {
        slot.classList.add('inzone');
        const Z = zoneEls[w.zone];
        (Z.paged ? (w.fill ? zoneFill(w.zone, w.page) : zoneColumn(w.zone, w.page, w.column)) : Z.el).appendChild(slot);
        if (w.fill) slot.classList.add('fill');
        const colW = Math.round(slot.getBoundingClientRect().width) || Math.round(innerWidth * .3);
        const f = makeFrame({ id: w.use, kind: 'widget', needs: w.needs, assets: w.assets, slot, zoned: true, zone: w.zone, fill: !!(w.fill && Z.paged), scale: (Z.z.scale || 1) * (w.scale || 1), w, idx, auto: { width: false, height: true },
          init: { settings: w.settings, needs: w.needs, sizing: { width: 'zone', height: 'auto' }, maxWidth: colW } }, slot);
        f.iframe.style.width = '100%'; f.iframe.style.height = '10px';
        return;
      }
      place(slot, w.position); host.appendChild(slot);
      if (w.page != null) { slot.dataset.page = w.page; slot.classList.add('paged'); }   // rotating page group
      const auto = { width: w.position.width === 'auto', height: w.position.height === 'auto' };
      const f = makeFrame({ id: w.use, kind: 'widget', needs: w.needs, assets: w.assets, slot, auto, scale: w.scale || 1, w, idx,
        init: { settings: w.settings, needs: w.needs, sizing: { width: w.position.width, height: w.position.height }, maxWidth: Math.round(innerWidth * .9) } }, slot);
      f.iframe.style.width = auto.width ? Math.round(innerWidth * .9) + 'px' : scaled(w.position.width, w.scale || 1);
      f.iframe.style.height = auto.height ? '10px' : cssLen(w.position.height);
      if (!auto.width && !auto.height) slot.classList.remove('pending');
    });
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

  /* ------------------------------------------------------------ layout editor bridge
     The editor (runtime/editor.js) is trusted page code. It drives the layout through this API; plugin frames
     are cross-origin and can't reach it. */
  function renderLayout(zones, widgets) {
    for (let i = frames.length - 1; i >= 0; i--) if (frames[i].kind === 'widget') { frames[i].dead = true; frames[i].iframe.remove(); frames.splice(i, 1); }
    $('widgets').textContent = '';
    for (const k of Object.keys(zoneEls)) delete zoneEls[k];
    rotTimers.forEach(clearInterval); rotTimers.length = 0;
    renderZones(zones);
    renderWidgets(widgets);
    startRotation();
    startFreePages();
  }
  window.__orbit = Object.freeze({
    get cfg() { return cfg; }, frames, zoneEls, last,
    place, cssLen, scaled, styleZone, showPage, renderLayout, send, themeMsg, viewport, showFreePage,
    get freePages() { return FP.pages.slice(); },
    setRotationPaused(on) { rotationPaused = on; },
  });
  window.orbitEdit = (on, insets) => { if (window.OrbitEditor) window.OrbitEditor.toggle(on, insets); };

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
    startFreePages();
    nightDim();
    renderProblems();
    startSignals();
    addEventListener('resize', broadcastTheme);
    setInterval(async () => {                                     // live-reload on layout.yaml / manifest change
      if (window.OrbitEditor && window.OrbitEditor.active) return;
      try { const v = await getJSON('/api/config/version'); if (v.version !== cfg.version) location.reload(); } catch (e) {}
    }, 5000);
  }
  boot();
})();
