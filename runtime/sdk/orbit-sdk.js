/* Orbit Desktop plugin SDK - runs INSIDE each sandboxed plugin frame.
 *
 * The frame has an opaque origin and a CSP with no network access. The only
 * channel to the outside is postMessage with the host runtime (window.parent).
 * The host only sends the signals listed in the plugin's `needs:`.
 *
 *   Orbit.widget({ mount(ctx) {}, on: { <signal>(data, ctx) {} }, theme(ctx) {} })
 *   Orbit.background({ fps, setup(ctx), resize(ctx), frame(ctx, f), on: {...} })
 *
 * See CONTRIBUTING.md for the full reference.
 */
(function () {
  'use strict';
  const PLUGIN = window.__ORBIT_PLUGIN__ || { id: 'unknown', kind: 'widget' };
  const parentWin = window.parent;
  const post = msg => { try { parentWin.postMessage(Object.assign({ orbit: 1 }, msg), '*'); } catch (_) {} };
  // Messages to the host carry no sensitive data; '*' is required because the host
  // cannot be addressed by origin from an opaque-origin (sandboxed) document.

  const root = document.getElementById('orbit-root');
  const ctx = {
    id: PLUGIN.id, kind: PLUGIN.kind, root,
    settings: {}, theme: {}, locale: 'en-US', lang: 'en', hour12: false,
    viewport: { w: innerWidth, h: innerHeight }, scale: 1, assets: {}, signals: {},
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    /** "r,g,b" triplet of a palette slot ('a' | 'b' | 'c') - usable as rgb(${...}) */
    rgb: k => (ctx.theme.palette || {})[k] || '255,255,255',
  };
  let def = null, started = false, initMsg = null;

  function reportError(msg) { post({ type: 'error', message: String(msg).slice(0, 400) }); }
  // "Script error." carries no information (the engine hides the details); don't report it
  addEventListener('error', e => { const m = e.message || 'error'; if (!/^Script error\.?$/.test(m)) reportError(m + (e.lineno ? ` (line ${e.lineno})` : '')); });
  addEventListener('unhandledrejection', e => reportError((e.reason && e.reason.message) || e.reason || 'unhandled rejection'));
  const safe = (fn, ...a) => { try { return fn && fn(...a); } catch (e) { reportError((e && e.stack) || e); } };

  function applyTheme() {
    const t = ctx.theme, s = document.documentElement.style, p = t.palette || {};
    if (t.font) s.setProperty('--font', t.font);
    if (t.mono_font) s.setProperty('--mono', t.mono_font);
    if (t.text_color) s.setProperty('--fg', t.text_color);
    for (const k of ['a', 'b', 'c']) if (p[k]) s.setProperty('--' + k, p[k]);
    // vh / vw of the HOST screen (inside an iframe the native units refer to the frame)
    // ctx.scale: per-widget size set in the HUD layout editor; scaling the units keeps text crisp
    s.setProperty('--vh', (ctx.viewport.h / 100 * ctx.scale) + 'px');
    s.setProperty('--vw', (ctx.viewport.w / 100 * ctx.scale) + 'px');
    ctx.locale = t.locale || 'en-US'; ctx.lang = ctx.locale.slice(0, 2).toLowerCase(); ctx.hour12 = !!t.hour12;
    document.documentElement.lang = ctx.locale;
  }

  // ---------------------------------------------------------------- auto sizing (widgets)
  let sizing = { width: 'auto', height: 'auto' }, lastSize = '';
  function reportSize() {
    if (PLUGIN.kind !== 'widget') return;
    const r = root.getBoundingClientRect();
    const w = Math.ceil(r.width), h = Math.ceil(Math.max(r.height, root.scrollHeight));
    const key = w + 'x' + h;
    if (key !== lastSize) { lastSize = key; post({ type: 'size', w, h }); }
  }
  if (window.ResizeObserver) new ResizeObserver(reportSize).observe(root);

  // ---------------------------------------------------------------- normalised levels (backgrounds)
  const lv = { cpu: 0, net: 0, audio: { level: 0, bass: 0, mid: 0, high: 0, bands: new Array(16).fill(0) } };
  const peak = { level: .05, bass: .02, mid: .005, high: .001 }, bandPeak = new Array(16).fill(1e-4);
  let audioRaw = null;
  function audioGateOpen() {
    // when the plugin also receives nowPlaying, audio counts only while music is playing
    if (!(initMsg && initMsg.needs || []).includes('nowPlaying')) return true;
    const np = ctx.signals.nowPlaying;
    return !!(np && np.state === 'playing');
  }
  function stepLevels(dt) {
    const k = Math.min(3, dt * 30);              // tuned at 30 fps
    const sys = ctx.signals.system || {};
    const cpuT = Math.min(1, (sys.cpu || 0) / 100 * 1.3);
    lv.cpu += (cpuT - lv.cpu) * .04 * k;
    const bps = sys.net ? (sys.net.rx || 0) + (sys.net.tx || 0) : 0;   // log scale: ~10 KB/s -> 0, ~50 MB/s -> 1
    const netT = Math.max(0, Math.min(1, (Math.log10(bps + 1) - 4) / 3.7));
    lv.net += (netT - lv.net) * .05 * k;
    const on = audioGateOpen(), au = audioRaw || {};
    for (const key of ['level', 'bass', 'mid', 'high']) {
      peak[key] = Math.max(peak[key] * Math.pow(.995, k), au[key] || 0, 1e-4);
      const v = on ? Math.min(1, (au[key] || 0) / peak[key]) : 0;
      lv.audio[key] = v > lv.audio[key] ? v : lv.audio[key] + (v - lv.audio[key]) * .18 * k;   // instant attack, quick release
    }
    const bands = (on && au.bands) || [];
    for (let i = 0; i < 16; i++) {
      const v = bands[i] || 0;
      bandPeak[i] = Math.max(bandPeak[i] * Math.pow(.997, k), v, 1e-4);
      const n = on ? Math.min(1, v / bandPeak[i]) : 0;
      lv.audio.bands[i] += (n - lv.audio.bands[i]) * (n > lv.audio.bands[i] ? .5 : .08);
    }
  }
  function source(name) {
    if (name === 'cpu') return lv.cpu;
    if (name === 'net') return lv.net;
    if (name.startsWith('audio.')) return lv.audio[name.slice(6)] || 0;
    return 0;
  }
  function reactions() {
    const out = {}, map = (initMsg && initMsg.react) || {};
    for (const h of (initMsg && initMsg.hooks) || []) out[h] = 0;
    for (const [src, hooks] of Object.entries(map)) for (const h of hooks) out[h] = Math.max(out[h] || 0, source(src));
    return out;
  }

  // ---------------------------------------------------------------- background loop
  function startBackground() {
    const canvas = document.createElement('canvas');
    canvas.className = 'orbit-canvas'; root.appendChild(canvas);
    ctx.canvas = canvas; ctx.g = canvas.getContext('2d');
    ctx.DPR = def.dpr || 1;
    const size = () => { ctx.W = canvas.width = Math.round(innerWidth * ctx.DPR); ctx.H = canvas.height = Math.round(innerHeight * ctx.DPR); };
    size();
    addEventListener('resize', () => { size(); safe(def.resize, ctx); });
    safe(def.setup, ctx);
    const minDt = 1000 / Math.max(1, Math.min(60, +(ctx.settings.fps || def.fps || 30)));
    let last = 0, t = 0;
    const loop = ts => {
      requestAnimationFrame(loop);
      if (ts - last < minDt - 1) return;
      const dt = Math.min(.1, (ts - last) / 1000); last = ts; t += dt;
      stepLevels(dt);
      safe(def.frame, ctx, { t, dt, levels: lv, react: reactions(), signals: ctx.signals });
    };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- messaging
  function start() {
    if (started || !def || !initMsg) return;
    started = true;
    if (PLUGIN.kind === 'background') startBackground();
    else safe(def.mount, ctx);
    for (const [name, data] of Object.entries(ctx.signals)) deliver(name, data);
    reportSize();
  }
  function deliver(name, data) {
    if (name === 'audio') audioRaw = data;
    const h = def && def.on && def.on[name];
    if (h) safe(h, data, ctx);
  }
  addEventListener('message', e => {
    if (e.source !== parentWin) return;
    const m = e.data;
    if (!m || m.orbit !== 1 || typeof m.type !== 'string') return;
    if (m.type === 'init') {
      initMsg = m;
      ctx.settings = Object.freeze(Object.assign({}, m.settings));
      ctx.theme = m.theme || {}; ctx.viewport = m.viewport || ctx.viewport; ctx.assets = m.assets || {};
      if (+m.scale > 0) ctx.scale = +m.scale;
      sizing = m.sizing || sizing;
      if (sizing.width !== 'auto') root.classList.add('fixed-w');   // 'zone' (width of the zone column) or a CSS length
      if (m.maxWidth) document.documentElement.style.setProperty('--max-w', m.maxWidth + 'px');
      applyTheme(); start();
    } else if (m.type === 'signal' && typeof m.name === 'string') {
      if (initMsg && !(initMsg.needs || []).includes(m.name)) return;   // defence in depth
      ctx.signals[m.name] = m.data;
      if (started) deliver(m.name, m.data);
    } else if (m.type === 'theme') {
      ctx.theme = m.theme || ctx.theme; if (m.viewport) ctx.viewport = m.viewport;
      if (+m.scale > 0) ctx.scale = +m.scale;
      applyTheme(); if (started && def.theme) safe(def.theme, ctx);
      reportSize();
    }
  });

  // ---------------------------------------------------------------- module kit (shared look, ported from the prototype)
  let visible = true;
  /** Show / hide this widget. A hidden widget in a zone collapses, and the others close up. */
  ctx.visible = on => { on = !!on; if (on !== visible) { visible = on; post({ type: 'visible', on }); } };
  const hists = {};
  const ui = Object.freeze({
    esc: ctx.esc,
    agoTxt: t => { const m = Math.round((Date.now() / 1000 - t) / 60); return m < 1 ? 'たった今' : m < 60 ? `${m}分前` : m < 1440 ? `${Math.round(m / 60)}時間前` : `${Math.round(m / 1440)}日前`; },
    dur: ms => { const m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60);
      return d ? `${d}日 ${h}時間` : h ? `${h}時間 ${m % 60}分` : `${m}分`; },
    ymd: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    day0: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; },
    kv: (k, v, cls = '') => `<div class="kv"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`,
    tile: (big, label, cls = '', extra = '') => `<div class="tile ${cls}"><b>${big}</b><span>${label}</span>${extra}</div>`,
    meter: (pct, color) => `<div class="meter"><i style="width:${Math.max(0, Math.min(100, pct))}%${color ? ';background:' + color : ''}"></i></div>`,
    fmtB: b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB/s' : (b / 1e3).toFixed(0) + ' KB/s',
    SCALE: { 10: '1', 20: '2', 30: '3', 40: '4', 45: '5弱', 50: '5強', 55: '6弱', 60: '6強', 70: '7' },
    WD: ['日', '月', '火', '水', '木', '金', '土'],
    WMO: c => c === 0 ? ['☀️', '快晴'] : c <= 2 ? ['🌤️', '晴れ'] : c === 3 ? ['☁️', 'くもり'] : c <= 48 ? ['☁️', '霧']
      : c <= 57 ? ['🌦️', '霧雨'] : c <= 67 ? ['🌧️', '雨'] : c <= 77 ? ['🌨️', '雪'] : c <= 82 ? ['🌧️', 'にわか雨'] : c <= 86 ? ['🌨️', 'にわか雪'] : ['⛈️', '雷雨'],
    dayWord: dd => dd === 0 ? '今日' : dd === 1 ? '明日' : dd === 2 ? 'あさって' : `あと${dd}日`,
    /** sparkline into the canvas with this id (keeps 60 values per id) */
    spark(id, val, max, color) {
      const h = hists[id] = (hists[id] || []).concat([val]).slice(-60);
      const c = document.getElementById(id); if (!c || !c.clientWidth) return;
      const g = c.getContext('2d'), w = c.width = c.clientWidth * 2, ht = c.height = c.clientHeight * 2;
      const m = max || Math.max(...h, 1e-9);
      g.beginPath();
      h.forEach((v, i) => { const x = i / 59 * w, y = ht - Math.min(1, v / m) * (ht - 2) - 1; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = color; g.lineWidth = 2; g.shadowColor = color; g.shadowBlur = 6; g.stroke();
    },
  });

  /**
   * Module frame: eyebrow header (title · hairline · meta) + body, in the shared module style.
   *   const m = Orbit.module(ctx, 'TONIGHT');  m.body.innerHTML = ...;  m.meta.innerHTML = ...;
   * Returns { el, body, meta }.
   */
  function module(c, title, cls = '') {
    document.body.classList.add('orbit-module');
    const el = document.createElement('section');
    el.className = 'mod ' + cls;
    el.innerHTML = `<header class="mh"><span class="eb"></span><i class="ln"></i><span class="mx"></span></header><div class="mb"></div>`;
    el.querySelector('.eb').textContent = title;
    c.root.appendChild(el);
    return { el, body: el.querySelector('.mb'), meta: el.querySelector('.mx') };
  }

  window.Orbit = Object.freeze({
    version: '0.2.0',
    ui, module,
    widget(d) { if (PLUGIN.kind !== 'widget') return reportError('Orbit.widget() used in a background plugin'); def = d || {}; start(); },
    background(d) { if (PLUGIN.kind !== 'background') return reportError('Orbit.background() used in a widget plugin'); def = d || {}; start(); },
    /** draw a sparkline into a <canvas>; returns the updated history */
    spark(canvas, hist, val, max, color, len = 60) {
      hist.push(val); while (hist.length > len) hist.shift();
      const g = canvas.getContext('2d'), w = canvas.width = canvas.clientWidth * 2, h = canvas.height = canvas.clientHeight * 2;
      const m = max || Math.max(...hist, 1e-9);
      g.beginPath();
      hist.forEach((v, i) => { const x = i / (len - 1) * w, y = h - Math.min(1, v / m) * (h - 2) - 1; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = color; g.lineWidth = 2; g.shadowColor = color; g.shadowBlur = 6; g.stroke();
      return hist;
    },
  });
  post({ type: 'ready' });
})();
