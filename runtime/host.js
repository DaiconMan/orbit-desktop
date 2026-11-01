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
    for (const f of frames) if (f.ready) send(f, { type: 'theme', theme: themeMsg(), viewport: viewport() });
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
    const warns = cfg && (Date.now() - bootAt < 20000 || location.search.includes('debug')) ? cfg.warnings : [];
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
      send(f, Object.assign({ type: 'init', theme: themeMsg(), viewport: viewport(), assets }, f.init));
      f.ready = true;
      for (const n of f.needs) if (last[n] !== undefined) send(f, { type: 'signal', name: n, data: last[n] });
    } else if (m.type === 'size' && f.auto) {
      const w = Math.max(0, Math.min(+m.w || 0, innerWidth)), h = Math.max(0, Math.min(+m.h || 0, innerHeight));
      if (f.auto.width) f.iframe.style.width = w + 'px';
      if (f.auto.height) f.iframe.style.height = h + 'px';
      f.slot.classList.remove('pending');
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
  function renderWidgets(list) {
    const host = $('widgets'); host.textContent = '';
    for (const w of list) {
      const slot = document.createElement('div'); slot.className = 'slot pending'; slot.dataset.widget = w.use;
      place(slot, w.position); host.appendChild(slot);
      const auto = { width: w.position.width === 'auto', height: w.position.height === 'auto' };
      const f = makeFrame({ id: w.use, kind: 'widget', needs: w.needs, assets: w.assets, slot, auto,
        init: { settings: w.settings, needs: w.needs, sizing: { width: w.position.width, height: w.position.height }, maxWidth: Math.round(innerWidth * .9) } }, slot);
      f.iframe.style.width = auto.width ? Math.round(innerWidth * .9) + 'px' : cssLen(w.position.width);
      f.iframe.style.height = auto.height ? '10px' : cssLen(w.position.height);
      if (!auto.width && !auto.height) slot.classList.remove('pending');
    }
  }

  /* ------------------------------------------------------------ signals */
  function publish(name, data) {
    last[name] = data;
    for (const f of frames) if (f.ready && !f.dead && f.needs.includes(name)) send(f, { type: 'signal', name, data });
  }
  const needed = () => new Set(frames.flatMap(f => f.needs));
  function every(ms, fn) { fn(); return setInterval(fn, ms); }

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
    if (n.has('weather') && p.weather) every(60000, async () => { try { const w = await getJSON('/api/signals/weather'); if (w) publish('weather', w); } catch (e) {} });
    if (n.has('location')) every(60000, async () => { try { const l = await getJSON('/api/signals/location'); if (l) publish('location', l); } catch (e) {} });
    if (n.has('claudeUsage') && p.claudeUsage) every(30000, async () => { try { const c = await getJSON('/api/signals/claude-usage'); if (c) publish('claudeUsage', c); } catch (e) {} });
    if (n.has('audio')) startAudio();
  }

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
    renderWidgets(cfg.widgets);
    renderProblems();
    startSignals();
    addEventListener('resize', broadcastTheme);
    setInterval(async () => {                                     // live-reload on layout.yaml / manifest change
      try { const v = await getJSON('/api/config/version'); if (v.version !== cfg.version) location.reload(); } catch (e) {}
    }, 5000);
  }
  boot();
})();
