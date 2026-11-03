/* Orbit Desktop — カスタマイズ (layout editor). Trusted page code, like host.js.
 *
 * Opened from the host app's menu (window.orbitEdit(true, insets)). Three parts on top of the live wallpaper:
 *   left   ライブラリ   every installed widget, by category, with search; drag one onto the desktop or press ＋
 *   centre the wallpaper itself: click a widget to select it, drag to move (snaps to edges / grid),
 *          corner handle = size, right edge = width
 *   right  インスペクタ  the selected widget: page, size, its settings (form generated from the manifest),
 *          its data sources (on/off), what a click does, remove. Nothing selected: 全体設定.
 *   bottom pages (常に表示 / 1..N / ＋), 元に戻す / やり直す, プレビュー (or hold Space), キャンセル, 完了
 * A layout that still uses zones is converted to free positions on entry, keeping the look.
 * 完了 sends {type: 'saveArrangement', ...} to the host app, which writes ~/.config/orbit-desktop/settings.json.
 * layout.yaml is never rewritten; it is what 初期配置に戻す returns to.
 */
(() => {
  'use strict';
  const O = () => window.__orbit;
  const E = { active: false, arr: null, sel: null, page: null, extraPages: new Set(), providers: {}, theme: {}, pageSeconds: null,
    undo: [], redo: [], cat: 'all', query: '', grid: true };
  const $c = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const vw = px => px / innerWidth * 100, vh = px => px / innerHeight * 100;
  const snap = (v, step) => Math.round(v / step) * step;
  const clone = o => JSON.parse(JSON.stringify(o));
  const SNAP_PX = 7;

  /* ---------------------------------------------------------------- words */
  const CATS = [['all', 'すべて'], ['time', '時間と予定'], ['weather', '天気と空'], ['system', 'Mac とネット'], ['dev', '開発'], ['life', '暮らし'], ['media', '音楽']];
  const PROVIDER_JA = { weather: '天気（Open-Meteo）', now_playing: '再生中の曲', claude_usage: 'Claude Code の使用量（非公式）', mac: 'Mac の状態',
    network: 'ネットワーク', iss: 'ISS の位置', quakes: '地震情報', holidays: '祝日', fx: '為替レート', news: 'ニュース（RSS）', bluetooth: 'Bluetooth 機器',
    onthisday: '今日は何の日（Wikipedia）', launches: 'ロケット打ち上げ', kp: '宇宙天気（NOAA）', recent: '再生履歴', contrib: 'GitHub の貢献', github: 'GitHub（gh）',
    sessions: 'Claude Code のセッション', rfc: 'RFC（gh）', cloud: 'クラウド同期フォルダ' };
  const ja = c => (c.i18n && c.i18n.ja) || {};
  const catalog = () => O().cfg.catalog || [];
  const cat = id => catalog().find(c => c.id === id) || { id, name: id, needs: [], assets: [], settings: {}, schema: {}, providers: [], i18n: {} };
  const nameOf = id => { const c = cat(id); return ja(c).name || c.name; };
  const descOf = id => { const c = cat(id); return ja(c).description || c.description || ''; };
  const providerOn = name => name in E.providers ? E.providers[name] : !!(O().cfg.providerState || {})[name];

  /* ---------------------------------------------------------------- geometry */
  function offsetsFor(anchor, r) {
    const [v, h] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
    const W = innerWidth, H = innerHeight;
    const x = h === 'left' ? r.left : h === 'right' ? W - r.right : r.left + r.width / 2 - W / 2;
    const y = v === 'top' ? r.top : v === 'bottom' ? H - r.bottom : r.top + r.height / 2 - H / 2;
    return { x: vw(x).toFixed(2) + 'vw', y: vh(y).toFixed(2) + 'vh' };
  }
  const anchorFor = r => {      // keep the nearest edge fixed when the content grows or the screen changes
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const v = cy < innerHeight / 3 ? 'top' : cy > innerHeight * 2 / 3 ? 'bottom' : 'center';
    const h = cx < innerWidth / 3 ? 'left' : cx > innerWidth * 2 / 3 ? 'right' : 'center';
    return v === 'center' && h === 'center' ? 'center' : `${v}-${h}`;
  };
  const R = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const rectOf = el => { const r = el.getBoundingClientRect(); return r.height < 2 ? Object.assign(R(r.left, r.top, Math.max(r.width, 160), 30), { empty: true }) : r; };

  /* ---------------------------------------------------------------- model + undo */
  const frameOf = idx => O().frames.find(f => f.kind === 'widget' && f.idx === idx && !f.dead);
  const state = () => JSON.stringify({ arr: E.arr, providers: E.providers, theme: E.theme, pageSeconds: E.pageSeconds });
  function remember() { E.undo.push(state()); if (E.undo.length > 100) E.undo.shift(); E.redo = []; drawBar(); }
  function restore(s) { const o = JSON.parse(s); E.arr = o.arr; E.providers = o.providers; E.theme = o.theme; E.pageSeconds = o.pageSeconds; E.sel = null; render(); }
  function undo() { if (!E.undo.length) return; E.redo.push(state()); restore(E.undo.pop()); }
  function redo() { if (!E.redo.length) return; E.undo.push(state()); restore(E.redo.pop()); }

  function fromConfig() {
    const cfg = O().cfg, hidden = new Set(cfg.hidden || []);
    return (cfg.allWidgets || cfg.widgets).filter(w => !hidden.has(w.use)).map(w => {
      const o = { use: w.use, settings: clone(w.settings || {}), scale: w.scale || 1 };
      if (w.dim === false) o.dim = false;
      if (w.action) o.action = clone(w.action);
      if (w.zone) Object.assign(o, { zone: w.zone, zpage: w.page || 0 });
      else { o.position = clone(w.position); if (w.page != null) o.page = w.page; }
      return o;
    });
  }
  function convertZones(list) {   // zones -> free positions, measured from the current rendering
    const zones = O().cfg.zones || {}, rendered = O().cfg.widgets, used = new Set();
    list.forEach(w => {
      if (!w.zone) return;
      const ri = rendered.findIndex((x, i) => !used.has(i) && x.use === w.use && x.zone === w.zone); used.add(ri);
      const f = O().frames.find(fr => fr.kind === 'widget' && fr.idx === ri && !fr.dead);
      const z = zones[w.zone] || {}, Z = O().zoneEls[w.zone];
      let r = f ? f.slot.getBoundingClientRect() : null;
      if (!r || r.height < 2) { const col = f && f.slot.parentElement, cr = col ? col.getBoundingClientRect() : R(innerWidth / 2, innerHeight / 2, 300, 0); r = R(cr.left, cr.top, cr.width || 300, 30); }
      const k = (z.scale || 1) * (w.scale || 1);
      const anchor = String(z.anchor || 'top-left').startsWith('top') ? (z.anchor || 'top-left') : anchorFor(r);
      w.position = Object.assign({ anchor, width: vw(r.width / k).toFixed(2) + 'vw', height: 'auto', z: 0 }, offsetsFor(anchor, r));
      w.scale = +k.toFixed(3);
      if (Z && Z.paged) w.page = w.zpage;
      delete w.zone; delete w.zpage;
    });
  }
  function resolved() {
    return E.arr.map(w => {
      const c = cat(w.use);
      return { use: w.use, name: c.name, needs: c.needs, assets: c.assets, settings: w.settings || clone(c.settings), actions: c.actions || [],
        zone: null, page: w.page != null ? w.page : null, dim: w.dim !== false, scale: w.scale || 1, action: null,
        position: w.position || { anchor: 'center', x: 0, y: 0, width: 'auto', height: 'auto', z: 0 } };
    });
  }
  const pagesInUse = () => [...new Set(E.arr.filter(w => w.page != null).map(w => w.page).concat([...E.extraPages]))].sort((a, b) => a - b);
  const onPage = w => w.page == null || w.page === E.page;
  let renderTimer = null;
  function render() {
    clearTimeout(renderTimer);
    O().renderLayout({}, resolved());
    O().showFreePage(E.page);
    drawAll();
  }
  const renderSoon = () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 450); };

  /* ---------------------------------------------------------------- desktop overlay */
  function drawAll() { drawBoxes(); drawBar(); drawInspector(); drawLibrary(); }
  function drawBoxes() {
    const L = E.layer; if (!L) return;
    L.querySelectorAll('.ed-box').forEach(b => b.remove());
    const drawn = [];
    E.arr.forEach((w, idx) => {
      const f = frameOf(idx); if (!f || w.dim === false || !onPage(w)) return;   // dim:false = overlays (alerts)
      const r = rectOf(f.slot);
      const b = $c('div', 'ed-box' + (E.sel === idx ? ' sel' : '') + (w.page != null ? ' paged' : '') + (r.empty ? ' empty' : ''));
      Object.assign(b.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      b.dataset.idx = idx;
      const tag = $c('div', 'ed-wtag', nameOf(w.use) + (r.empty ? '（いまは表示なし）' : '') + (Math.abs((w.scale || 1) - 1) > .001 ? `　${Math.round(w.scale * 100)}%` : ''));
      b.appendChild(tag);
      b.onpointerdown = ev => dragWidget(ev, { idx });
      if (E.sel === idx) {
        const hs = $c('div', 'ed-h scale'); hs.title = 'ドラッグで大きさ'; hs.onpointerdown = ev => resize(ev, idx, 'scale');
        const hw = $c('div', 'ed-h width'); hw.title = 'ドラッグで幅'; hw.onpointerdown = ev => resize(ev, idx, 'width');
        b.append(hs, hw);
      }
      L.appendChild(b);
      if (!r.empty) drawn.push([b, r]);
    });
    for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
      const [a, ra] = drawn[i], [b, rb] = drawn[j];
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 0 && oy > 0 && ox * oy > .15 * Math.min(ra.width * ra.height, rb.width * rb.height)) { a.classList.add('overlap'); b.classList.add('overlap'); }
    }
  }

  /* ---------------------------------------------------------------- snapping, move, size */
  function snapRect(r, ignoreIdx, useGrid) {
    const xs = [innerWidth / 2], ys = [innerHeight / 2];
    E.arr.forEach((w, i) => {
      if (i === ignoreIdx || !onPage(w) || w.dim === false) return;
      const f = frameOf(i); if (!f) return; const q = f.slot.getBoundingClientRect(); if (q.height < 2) return;
      xs.push(q.left, q.right, q.left + q.width / 2); ys.push(q.top, q.bottom, q.top + q.height / 2);
    });
    let dx = null, dy = null, gx = null, gy = null;
    for (const edge of [r.left, r.right, r.left + r.width / 2]) for (const x of xs) if (Math.abs(edge - x) < SNAP_PX && (dx === null || Math.abs(x - edge) < Math.abs(dx))) { dx = x - edge; gx = x; }
    for (const edge of [r.top, r.bottom, r.top + r.height / 2]) for (const y of ys) if (Math.abs(edge - y) < SNAP_PX && (dy === null || Math.abs(y - edge) < Math.abs(dy))) { dy = y - edge; gy = y; }
    let left = r.left + (dx || 0), top = r.top + (dy || 0);
    if (useGrid && dx === null) left = snap(vw(left), .5) / 100 * innerWidth;
    if (useGrid && dy === null) top = snap(vh(top), .5) / 100 * innerHeight;
    E.guideX.style.display = gx === null ? 'none' : 'block'; if (gx !== null) E.guideX.style.left = gx + 'px';
    E.guideY.style.display = gy === null ? 'none' : 'block'; if (gy !== null) E.guideY.style.top = gy + 'px';
    return R(left, top, r.width, r.height);
  }
  const hideGuides = () => { E.guideX.style.display = E.guideY.style.display = 'none'; };
  function placeLive(w, f, r) {
    w.position.anchor = anchorFor(r);
    Object.assign(w.position, offsetsFor(w.position.anchor, r));
    const st = f.slot.style; for (const p of ['left', 'right', 'top', 'bottom', 'transform']) st[p] = '';
    O().place(f.slot, w.position);
  }
  const inRect = (el, ev) => { if (!el) return false; const p = el.getBoundingClientRect(); return ev.clientX >= p.left && ev.clientX <= p.right && ev.clientY >= p.top && ev.clientY <= p.bottom; };
  function select(idx) { E.sel = idx; drawBoxes(); drawInspector(); }
  function dragWidget(e, src) {      // src: {idx} existing widget, or {add: catalogId} from the library
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    const w = src.idx != null ? E.arr[src.idx] : null, f = src.idx != null ? frameOf(src.idx) : null;
    const r0 = f ? rectOf(f.slot) : null;
    let moved = false, onLib = false;
    const ghost = src.add ? $c('div', 'ed-ghost', nameOf(src.add)) : null;
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) { moved = true; if (w) remember(); if (ghost) E.layer.appendChild(ghost); if (src.idx != null) E.sel = src.idx; document.body.classList.add('ed-dragging'); }
      onLib = inRect(E.lib, ev);
      E.lib.classList.toggle('drop', onLib && !!w);
      if (ghost) Object.assign(ghost.style, { left: ev.clientX + 12 + 'px', top: ev.clientY + 12 + 'px' });
      if (w && f) placeLive(w, f, snapRect(R(r0.left + ev.clientX - x0, r0.top + ev.clientY - y0, r0.width, r0.height), src.idx, E.grid && !ev.altKey));
      drawBoxes();
    };
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      hideGuides(); if (ghost) ghost.remove(); E.lib.classList.remove('drop'); document.body.classList.remove('ed-dragging');
      if (!moved) { if (src.idx != null) select(src.idx); return; }
      if (w && onLib) { E.arr.splice(src.idx, 1); E.sel = null; render(); return; }
      if (src.add && !onLib && !inRect(E.insp, ev)) addAt(src.add, ev.clientX, ev.clientY);
      else drawAll();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  function addAt(id, x, y) {
    remember();
    const c = cat(id), ds = c.defaultSize || {};
    const r = R(x - 150, y - 50, 300, 100), anchor = anchorFor(r);
    const w = { use: id, settings: clone(c.settings), scale: 1,
      position: Object.assign({ anchor, width: ds.width && ds.width !== 'auto' ? ds.width : 'auto', height: 'auto', z: 0 }, offsetsFor(anchor, r)) };
    if (E.page != null) w.page = E.page;
    E.arr.push(w); E.sel = E.arr.length - 1; render();
  }
  function resize(e, idx, mode) {
    e.preventDefault(); e.stopPropagation();
    remember();
    const w = E.arr[idx], f = frameOf(idx), r0 = f.slot.getBoundingClientRect(), x0 = e.clientX, s0 = w.scale || 1, W0 = Math.max(r0.width, 60);
    const move = ev => {
      const g = E.grid && !ev.altKey, dx = ev.clientX - x0;
      if (mode === 'scale') setScale(idx, s0 * Math.max(.2, (W0 + dx) / W0), g);
      else { let v = vw(Math.max(80, W0 + dx)) / s0; if (g) v = snap(v, .5); w.position.width = v.toFixed(1) + 'vw'; f.iframe.style.width = O().scaled(w.position.width, w.scale || 1); }
      const r = f.slot.getBoundingClientRect(); placeLive(w, f, R(r0.left, r0.top, r.width, r.height));
      drawBoxes();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); setTimeout(() => { drawBoxes(); drawInspector(); }, 400); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  function setScale(idx, k, g) {
    const w = E.arr[idx], f = frameOf(idx);
    k = Math.min(3, Math.max(.4, g ? snap(k, .05) : k)); w.scale = +k.toFixed(3);
    if (!f) return;
    f.scale = w.scale;
    if (f.ready) O().send(f, { type: 'theme', theme: O().themeMsg(), viewport: O().viewport(), scale: f.scale });
    if (w.position.width !== 'auto') f.iframe.style.width = O().scaled(w.position.width, w.scale);
  }

  /* ---------------------------------------------------------------- library (left) */
  function drawLibrary() {
    const L = E.lib; if (!L) return;
    const list = L.querySelector('.ed-plist'); list.textContent = '';
    L.querySelectorAll('.ed-cats button').forEach(b => b.classList.toggle('on', b.dataset.cat === E.cat));
    const used = new Set(E.arr.map(w => w.use)), q = E.query.trim().toLowerCase();
    for (const c of catalog()) {
      if (c.id === 'alerts') continue;
      if (E.cat !== 'all' && c.category !== E.cat) continue;
      const nm = nameOf(c.id), ds = descOf(c.id);
      if (q && !(nm + ds + c.name + c.id).toLowerCase().includes(q)) continue;
      const it = $c('div', 'ed-pitem'), t = $c('div', 'ed-ptext');
      t.append($c('b', null, nm), $c('small', null, ds));
      const off = (c.providers || []).filter(p => !providerOn(p));
      if (used.has(c.id)) t.appendChild($c('em', 'used', '配置済み'));
      if (off.length) {
        const e = $c('em', 'off', 'データ源がオフ　'), on = $c('button', 'link', 'オンにする');
        on.onclick = ev => { ev.stopPropagation(); remember(); off.forEach(p => { E.providers[p] = true; }); drawAll(); };
        e.appendChild(on); t.appendChild(e);
      }
      const add = $c('button', 'add', '＋'); add.title = '画面の中央に追加'; add.setAttribute('aria-label', nm + ' を追加');
      add.onclick = ev => { ev.stopPropagation(); addAt(c.id, innerWidth / 2, innerHeight / 2); };
      it.append(t, add);
      it.onpointerdown = ev => { if (ev.target.tagName !== 'BUTTON') dragWidget(ev, { add: c.id }); };
      list.appendChild(it);
    }
    if (!list.children.length) list.appendChild($c('div', 'ed-empty', '見つかりません'));
  }
  function buildLibrary() {
    const L = $c('aside', 'ed-lib');
    const h = $c('h2', null, 'ライブラリ'), fold = $c('button', 'fold', '‹'); fold.title = '閉じる'; fold.setAttribute('aria-label', 'ライブラリを閉じる');
    fold.onclick = () => L.classList.add('closed');
    const tab = $c('button', 'ed-tab', '＋ ライブラリ'); tab.onclick = () => L.classList.remove('closed');
    h.appendChild(fold); L.append(tab, h);
    const lab = $c('label', 'ed-search'); lab.append('検索');
    const inp = $c('input'); inp.type = 'search'; inp.placeholder = 'ウィジェットを探す';
    inp.oninput = () => { E.query = inp.value; drawLibrary(); };
    lab.appendChild(inp); L.appendChild(lab);
    const cats = $c('div', 'ed-cats');
    for (const [id, label] of CATS) { const b = $c('button', null, label); b.dataset.cat = id; b.onclick = () => { E.cat = id; drawLibrary(); }; cats.appendChild(b); }
    L.append(cats, $c('div', 'ed-plist'), $c('p', 'ed-hint', 'デスクトップへドラッグするか ＋ で追加。ウィジェットをここへドラッグすると外せます。'));
    return L;
  }

  /* ---------------------------------------------------------------- inspector (right) */
  const section = (title) => { const s = $c('section', 'ed-sec'); s.appendChild($c('h3', null, title)); return s; };
  function row(label, control, hint) {
    const l = $c('label', 'ed-row'); l.append($c('span', 'k', label), control);
    if (hint) l.appendChild($c('small', null, hint));
    return l;
  }
  function settingControl(w, key, spec, labels) {
    const v = w.settings[key], set = val => { remember(); w.settings[key] = val; renderSoon(); };
    const t = spec.type;
    if (t === 'boolean') { const i = $c('input'); i.type = 'checkbox'; i.checked = !!v; i.onchange = () => set(i.checked); return i; }
    if (t === 'enum') { const s = $c('select'); for (const o of spec.options || []) s.appendChild(new Option((labels && labels[String(o)]) || String(o), String(o))); s.value = String(v); s.onchange = () => set(typeof (spec.options || [])[0] === 'number' ? +s.value : s.value); return s; }
    if (t === 'number' || t === 'integer') {
      const i = $c('input'); i.type = 'number'; if (spec.min != null) i.min = spec.min; if (spec.max != null) i.max = spec.max; i.step = t === 'integer' ? 1 : 'any'; i.value = v;
      i.onchange = () => { const n = t === 'integer' ? parseInt(i.value, 10) : parseFloat(i.value); if (!isNaN(n)) set(n); }; return i;
    }
    if (t === 'color' && /^#[0-9a-f]{6}$/i.test(String(v || ''))) { const i = $c('input'); i.type = 'color'; i.value = v; i.onchange = () => set(i.value); return i; }
    if (t === 'list') {
      const simple = !spec.items || ['string', 'number', 'integer'].includes(spec.items.type);
      const ta = $c('textarea'); ta.rows = Math.min(6, Math.max(2, (v || []).length + 1));
      ta.value = simple ? (v || []).join('\n') : JSON.stringify(v || [], null, 1);
      ta.onchange = () => {
        if (simple) set(ta.value.split('\n').map(x => x.trim()).filter(Boolean).map(x => spec.items && spec.items.type !== 'string' ? +x : x));
        else { try { set(JSON.parse(ta.value)); ta.classList.remove('bad'); } catch (_) { ta.classList.add('bad'); } }
      };
      return ta;
    }
    const i = $c('input'); i.type = 'text'; i.value = v == null ? '' : v; i.onchange = () => set(i.value); return i;
  }
  const ACTIONS = [['', 'なし'], ['music', '音楽を操作'], ['app', 'アプリを開く'], ['url', 'URL を開く'], ['shortcut', 'ショートカットを実行'], ['script', 'スクリプトを実行']];
  const MUSIC = [['playpause', '再生 / 一時停止'], ['next', '次の曲'], ['previous', '前の曲'], ['shuffle', 'シャッフル'], ['repeat', 'リピート']];
  function actionControls(w, sec) {
    const a = w.action || { type: '', value: '' };
    const s = $c('select'); for (const [v, l] of ACTIONS) s.appendChild(new Option(l, v)); s.value = a.type || '';
    sec.appendChild(row('動作', s));
    let val;
    if (a.type === 'music') { val = $c('select'); for (const [v, l] of MUSIC) val.appendChild(new Option(l, v)); val.value = a.value || 'playpause'; }
    else if (a.type) { val = $c('input'); val.type = 'text'; val.value = a.value || '';
      val.placeholder = { app: 'カレンダー / com.apple.iCal', url: 'https://…', shortcut: 'ショートカット名', script: '~/bin/… (実行できるファイル)' }[a.type]; }
    const apply = () => { remember(); if (!s.value) delete w.action; else w.action = { type: s.value, value: val ? val.value : (s.value === 'music' ? 'playpause' : '') }; drawInspector(); };
    s.onchange = () => { if (val) val.value = ''; val = null; apply(); };
    if (val) { val.onchange = apply; sec.appendChild(row(a.type === 'music' ? '操作' : '対象', val)); }
    sec.appendChild($c('small', 'ed-note', 'クリックで動くのは、編集を終えたあとの壁紙で。'));
  }
  function drawInspector() {
    const P = E.insp; if (!P) return;
    P.textContent = '';
    const tab = $c('button', 'ed-tab', '設定 ›'); tab.onclick = () => P.classList.remove('closed');
    const fold = $c('button', 'fold', '›'); fold.title = '閉じる'; fold.setAttribute('aria-label', '設定を閉じる'); fold.onclick = () => P.classList.add('closed');
    P.append(tab, fold);
    const w = E.sel != null ? E.arr[E.sel] : null;
    if (!w) return drawGlobal(P);
    const c = cat(w.use), J = ja(c);
    const head = $c('header'); head.append($c('h2', null, nameOf(w.use)), $c('p', null, descOf(w.use))); P.appendChild(head);

    const s1 = section('表示');
    const pg = $c('select'); pg.appendChild(new Option('常に表示', ''));
    const ps = pagesInUse(); if (E.page != null && !ps.includes(E.page)) ps.push(E.page);
    for (const p of [...new Set(ps)].sort((a, b) => a - b)) pg.appendChild(new Option(`ページ ${p + 1}`, String(p)));
    if (!ps.length) pg.appendChild(new Option('ページ 1（新しく作る）', '0'));
    pg.value = w.page == null ? '' : String(w.page);
    pg.onchange = () => { remember(); if (pg.value === '') delete w.page; else { w.page = +pg.value; E.page = w.page; } render(); };
    s1.appendChild(row('表示するページ', pg));
    const sz = $c('input'); sz.type = 'range'; sz.min = 40; sz.max = 300; sz.step = 5; sz.value = Math.round((w.scale || 1) * 100);
    const szv = $c('span', 'v', sz.value + '%');
    sz.onpointerdown = () => remember();
    sz.oninput = () => { setScale(E.sel, sz.value / 100, false); szv.textContent = sz.value + '%'; drawBoxes(); };
    const szr = row('大きさ', sz); szr.appendChild(szv); s1.appendChild(szr);
    const auto = $c('input'); auto.type = 'checkbox'; auto.checked = w.position.width === 'auto';
    auto.onchange = () => { remember(); if (auto.checked) w.position.width = 'auto'; else { const f = frameOf(E.sel); w.position.width = (f ? vw(f.slot.getBoundingClientRect().width / (w.scale || 1)) : 20).toFixed(1) + 'vw'; } render(); };
    s1.appendChild(row('幅を中身に合わせる', auto, auto.checked ? '' : '幅は枠の右端をドラッグ'));
    P.appendChild(s1);

    const keys = Object.keys(c.schema || {});
    if (keys.length) {
      const s2 = section('内容');
      for (const k of keys) s2.appendChild(row((J.settings && J.settings[k]) || k, settingControl(w, k, c.schema[k], (J.options || {})[k]), (c.schema[k] || {}).description && !(J.settings && J.settings[k]) ? c.schema[k].description : ''));
      P.appendChild(s2);
    }
    if ((c.providers || []).length) {
      const s3 = section('データ源');
      for (const p of c.providers) {
        const i = $c('input'); i.type = 'checkbox'; i.checked = providerOn(p);
        i.onchange = () => { remember(); E.providers[p] = i.checked; drawLibrary(); drawInspector(); };
        s3.appendChild(row(PROVIDER_JA[p] || p, i));
      }
      if (Object.keys(E.providers).some(p => E.providers[p] !== !!(O().cfg.providerState || {})[p])) s3.appendChild($c('small', 'ed-note', 'データ源の変更は「完了」のあとに反映されます。'));
      P.appendChild(s3);
    }
    const s4 = section('クリックしたとき');
    if ((c.actions || []).length) s4.appendChild($c('small', 'ed-note', 'このウィジェットには操作ボタンがあります。'));
    else actionControls(w, s4);
    P.appendChild(s4);
    const rm = $c('button', 'danger', '壁紙から外す');
    rm.onclick = () => { remember(); E.arr.splice(E.sel, 1); E.sel = null; render(); };
    P.appendChild(rm);
  }
  function drawGlobal(P) {
    P.appendChild((() => { const h = $c('header'); h.append($c('h2', null, '全体の設定'), $c('p', null, 'ウィジェットをクリックすると、そのウィジェットの設定が出ます。')); return h; })());
    const s = section('表示');
    const nd = $c('input'); nd.type = 'checkbox'; nd.checked = 'night_dim' in E.theme ? E.theme.night_dim : !!(O().cfg.theme || {}).night_dim;
    nd.onchange = () => { remember(); E.theme.night_dim = nd.checked; };
    s.appendChild(row('夜（0〜6時）は少し暗くする', nd));
    const sec = E.pageSeconds || O().cfg.pageSeconds || 30;
    const r = $c('input'); r.type = 'range'; r.min = 10; r.max = 120; r.step = 5; r.value = sec;
    const rv = $c('span', 'v', sec + '秒');
    r.onpointerdown = () => remember();
    r.oninput = () => { E.pageSeconds = +r.value; rv.textContent = r.value + '秒'; };
    const rr = row('ページの切り替え間隔', r); rr.appendChild(rv); s.appendChild(rr);
    P.appendChild(s);
    const s2 = section('そのほか');
    s2.appendChild($c('p', 'ed-note', '緊急地震速報やログイン時の起動は、メニューバーの ✦ →「設定…」にあります。'));
    const reset = $c('button', null, '初期配置に戻す');
    reset.onclick = () => { if (confirm('最初の配置（layout.yaml）に戻しますか？ ここで変えた配置は消えます。')) toHost({ type: 'saveArrangement', arrangement: null, hidden: [] }) || location.reload(); };
    s2.appendChild(reset);
    P.appendChild(s2);
  }

  /* ---------------------------------------------------------------- bottom bar */
  function drawBar() {
    const t = E.tabs; if (!t) return;
    t.textContent = '';
    const tab = (label, p, title) => { const b = $c('button', E.page === p ? 'on' : '', label); b.title = title; b.onclick = () => { E.page = p; E.sel = null; O().showFreePage(p); drawAll(); }; t.appendChild(b); };
    tab('常に表示', null, 'いつも表示するウィジェット');
    for (const p of pagesInUse()) tab(String(p + 1), p, `ページ ${p + 1}：${E.pageSeconds || O().cfg.pageSeconds || 30} 秒ごとに順番に表示`);
    const add = $c('button', 'add', '＋'); add.title = 'ページを足す（順番に切り替わって表示されます）';
    add.onclick = () => { const ps = pagesInUse(); const n = ps.length ? ps[ps.length - 1] + 1 : 0; E.extraPages.add(n); E.page = n; E.sel = null; O().showFreePage(n); drawAll(); };
    t.appendChild(add);
    if (E.undoBtn) { E.undoBtn.disabled = !E.undo.length; E.redoBtn.disabled = !E.redo.length; }
  }
  function toHost(msg) { try { window.webkit.messageHandlers.orbit.postMessage(msg); return true; } catch (e) { return false; } }
  function serialize() {
    const used = pagesInUse().filter(p => E.arr.some(w => w.page === p));
    const widgets = clone(E.arr).map(w => { if (w.page != null) w.page = used.indexOf(w.page); if (w.scale === 1) delete w.scale; return w; });
    return { zones: {}, widgets };
  }
  function save() {
    const msg = { type: 'saveArrangement', arrangement: serialize(), hidden: [], providers: Object.fromEntries(Object.entries(E.providers).map(([k, v]) => [k, { enabled: v }])) };
    if ('night_dim' in E.theme) msg.theme = { night_dim: E.theme.night_dim };
    if (E.pageSeconds) msg.pageSeconds = E.pageSeconds;
    if (!toHost(msg)) alert('保存は Orbit Desktop.app の中でのみできます');
  }
  function buildBar() {
    const bar = $c('div', 'ed-bar');
    bar.appendChild($c('span', 'lbl', 'ページ'));
    E.tabs = $c('span', 'ed-tabs'); bar.appendChild(E.tabs);
    bar.appendChild($c('span', 'sep'));
    const btn = (label, fn, cls, title) => { const b = $c('button', cls || '', label); b.onclick = fn; if (title) b.title = title; bar.appendChild(b); return b; };
    E.undoBtn = btn('元に戻す', undo, '', '⌘Z'); E.redoBtn = btn('やり直す', redo, '', '⇧⌘Z');
    btn('プレビュー', () => setPreview(!document.body.classList.contains('ed-preview')), '', 'Space を押している間も');
    btn('キャンセル', () => { if (!toHost({ type: 'exitEdit' })) toggle(false); }, '', 'Esc');
    btn('完了', save, 'primary', 'Enter');
    return bar;
  }
  function setPreview(on) { document.body.classList.toggle('ed-preview', on); if (!on) drawBoxes(); }

  /* ---------------------------------------------------------------- enter / leave */
  function toggle(on, insets) {
    if (insets) for (const k of ['top', 'bottom', 'left', 'right']) document.documentElement.style.setProperty('--safe-' + k, (+insets[k] || 0) + 'px');
    if (on === E.active || !O() || !O().cfg) return;
    if (!on) { location.reload(); return; }
    E.active = true;
    O().setRotationPaused(true);
    document.body.classList.add('editing');
    Object.assign(E, { sel: null, extraPages: new Set(), providers: {}, theme: {}, pageSeconds: null, undo: [], redo: [] });
    E.arr = fromConfig();
    convertZones(E.arr);
    E.page = (() => { const ps = pagesInUse(); return ps.length ? ps[0] : null; })();
    E.layer = $c('div', 'ed-layer grid'); E.layer.id = 'editor';
    E.layer.onpointerdown = ev => { if (ev.target === E.layer) select(null); };
    E.guideX = $c('div', 'ed-guide x'); E.guideY = $c('div', 'ed-guide y'); E.layer.append(E.guideX, E.guideY);
    E.lib = buildLibrary(); E.insp = $c('aside', 'ed-insp');
    document.body.append(E.layer, E.lib, E.insp, buildBar());
    render();
    E.timer = setInterval(() => { if (!document.body.classList.contains('ed-preview')) drawBoxes(); }, 800);
  }
  addEventListener('keydown', e => {
    if (!E.active) return;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (typing) return;
    if (e.code === 'Space' && !e.repeat) { setPreview(true); e.preventDefault(); }
    else if (e.key === 'Escape') { if (E.sel != null) select(null); else if (!toHost({ type: 'exitEdit' })) toggle(false); }
    else if (e.key === 'Enter') save();
    else if ((e.key === 'Backspace' || e.key === 'Delete') && E.sel != null) { remember(); E.arr.splice(E.sel, 1); E.sel = null; render(); }
    else if (E.sel != null && e.key.startsWith('Arrow')) {
      const w = E.arr[E.sel], f = frameOf(E.sel); if (!f) return;
      if (!e.repeat) remember();
      const r = f.slot.getBoundingClientRect(), d = e.shiftKey ? 1 : .1;
      const dx = (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0) * innerWidth / 100, dy = (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0) * innerHeight / 100;
      placeLive(w, f, R(r.left + dx, r.top + dy, r.width, r.height)); drawBoxes(); e.preventDefault();
    }
  });
  addEventListener('keyup', e => { if (E.active && e.code === 'Space') setPreview(false); });
  window.OrbitEditor = { toggle, serialize, get active() { return E.active; } };
})();
