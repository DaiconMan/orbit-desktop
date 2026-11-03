/* Orbit Desktop layout editor (trusted page code, like host.js). HUD-style: every widget is placed freely.
 *
 * Opened from the host app's menu (window.orbitEdit(true, insets)). It edits a copy of the arrangement and
 * re-renders the real widgets, so what you see is what you get.
 *   - drag a widget to move it (snaps to the grid and to other widgets' edges, with guide lines)
 *   - corner handle = size, right edge = width; overlapping widgets get a red frame
 *   - page tabs (bottom): 常に表示 = always shown; 1, 2, … = page groups that take turns on the wallpaper
 *   - palette (left): every installed widget; drag it onto the desktop or click ＋ (goes to the current tab)
 *   - hold Space (or プレビュー) to see the result without the editor
 * A layout that still uses zones (layout.yaml) is converted to free positions on entry, keeping the look.
 * 保存 sends {type: 'saveArrangement'} to the host app, which stores it in ~/.config/orbit-desktop/settings.json.
 * layout.yaml stays untouched and is the 初期配置.
 */
(() => {
  'use strict';
  const O = () => window.__orbit;
  const E = { active: false, arr: null, hidden: new Set(), grid: true, sel: null, layer: null, page: null, extraPages: new Set(), converted: false };
  const $c = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const vw = px => px / innerWidth * 100, vh = px => px / innerHeight * 100;
  const snap = (v, step) => Math.round(v / step) * step;
  const clone = o => JSON.parse(JSON.stringify(o));
  const SNAP_PX = 7;

  /* ---------------------------------------------------------------- names */
  const JA = { weather: '天気', load: '負荷', homenet: '自宅ネットワーク', tonight: '今夜の空', sky: '星図', life: '暮らし',
    ops: '開発・運用', mac: 'Mac', countdown: 'カウントダウン', world: '世界時計', progress: '進み具合', contrib: 'GitHub ヒートマップ',
    month: '月カレンダー', week: '今週の予定', recent: '最近の曲', news: 'ニュース', rain: '雨（2時間）', pressure: '気圧',
    bluetooth: 'Bluetooth 機器', onthisday: '今日は何の日', launches: 'ロケット打ち上げ', kp: '宇宙天気（Kp）',
    'now-playing': '再生中の曲', clock: '時計', schedule: '予定', alerts: '緊急地震速報・津波', 'system-stats': 'システム情報',
    'claude-usage': 'Claude 残量', cloud: 'クラウド同期' };
  const lang = () => ((O().cfg.theme || {}).locale || navigator.language || '').toLowerCase();
  const catalog = () => (O().cfg.catalog || []).map(c => Object.assign({}, c, { name: lang().startsWith('en') ? c.name : (JA[c.id] || c.name) }));
  const cat = id => catalog().find(c => c.id === id) || { id, name: id, needs: [], assets: [], settings: {}, providersOff: [] };

  /* ---------------------------------------------------------------- geometry */
  function offsetsFor(anchor, r) {
    const [v, h] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
    const W = innerWidth, H = innerHeight;
    const x = h === 'left' ? r.left : h === 'right' ? W - r.right : r.left + r.width / 2 - W / 2;
    const y = v === 'top' ? r.top : v === 'bottom' ? H - r.bottom : r.top + r.height / 2 - H / 2;
    return { x: vw(x).toFixed(2) + 'vw', y: vh(y).toFixed(2) + 'vh' };
  }
  // anchor by where the widget sits, so it keeps its edge when its content grows or the screen changes
  const anchorFor = r => {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const v = cy < innerHeight / 3 ? 'top' : cy > innerHeight * 2 / 3 ? 'bottom' : 'center';
    const h = cx < innerWidth / 3 ? 'left' : cx > innerWidth * 2 / 3 ? 'right' : 'center';
    return v === 'center' && h === 'center' ? 'center' : `${v}-${h}`;
  };
  const R = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const rectOf = el => {
    const r = el.getBoundingClientRect();
    return r.height < 2 ? Object.assign(R(r.left, r.top, Math.max(r.width, 160), 30), { empty: true }) : r;
  };

  /* ---------------------------------------------------------------- model */
  const frameOf = idx => O().frames.find(f => f.kind === 'widget' && f.idx === idx && !f.dead);
  function fromConfig() {
    const cfg = O().cfg;
    return (cfg.allWidgets || cfg.widgets).map(w => {
      const o = { use: w.use, settings: clone(w.settings || {}), scale: w.scale || 1 };
      if (w.dim === false) o.dim = false;
      if (w.zone) Object.assign(o, { zone: w.zone, zpage: w.page || 0 });
      else { o.position = clone(w.position); if (w.page != null) o.page = w.page; }
      return o;
    });
  }
  // zones -> free positions measured from the current rendering (all zone pages exist in the DOM).
  // Widgets are matched to frames by order: the config's widget list is what host.js rendered.
  function convertZones(list) {
    const zones = O().cfg.zones || {}, rendered = O().cfg.widgets;
    let any = false;
    list.forEach(w => {
      if (!w.zone) return;
      any = true;
      const ri = rendered.findIndex((x, i) => x.use === w.use && x.zone === w.zone && !rendered.slice(0, i).includes(w.__claimed));
      const f = O().frames.find(fr => fr.kind === 'widget' && fr.idx === ri && !fr.dead);
      const z = zones[w.zone] || {}, Z = O().zoneEls[w.zone];
      let r = f ? f.slot.getBoundingClientRect() : null;
      if (!r || r.height < 2) {                         // hidden / empty right now: put it at its column's top
        const col = f && f.slot.parentElement, cr = col ? col.getBoundingClientRect() : R(innerWidth / 2, innerHeight / 2, 300, 0);
        r = R(cr.left, cr.top, cr.width || 300, 30);
      }
      const k = (z.scale || 1) * (w.scale || 1);
      const anchor = String(z.anchor || 'top-left').startsWith('top') ? (z.anchor || 'top-left') : anchorFor(r);
      w.position = Object.assign({ anchor, width: vw(r.width / k).toFixed(2) + 'vw', height: 'auto', z: 0 }, offsetsFor(anchor, r));
      w.scale = +k.toFixed(3);
      if (Z && Z.paged) w.page = w.zpage;
      delete w.zone; delete w.zpage;
    });
    return any;
  }
  function resolved() {   // -> the shape host.js renders (like /api/config widgets)
    return E.arr.map(w => {
      const c = cat(w.use);
      return { use: w.use, name: c.name, needs: c.needs, assets: c.assets, settings: w.settings || clone(c.settings),
        zone: null, page: w.page != null ? w.page : null, dim: w.dim !== false, scale: w.scale || 1,
        position: w.position || { anchor: 'center', x: 0, y: 0, width: 'auto', height: 'auto', z: 0 } };
    });
  }
  const pagesInUse = () => [...new Set(E.arr.filter(w => w.page != null).map(w => w.page).concat([...E.extraPages]))].sort((a, b) => a - b);
  function render() {
    O().renderLayout({}, resolved());
    for (const s of document.querySelectorAll('#widgets .slot')) s.classList.toggle('ed-hidden', E.hidden.has(s.dataset.widget));
    O().showFreePage(E.page);
    drawAll();
  }
  const onPage = w => w.page == null || w.page === E.page;

  /* ---------------------------------------------------------------- overlay */
  function drawAll() { drawBoxes(); drawTabs(); }
  function drawBoxes() {
    const L = E.layer; if (!L) return;
    L.querySelectorAll('.ed-box').forEach(b => b.remove());
    const drawn = [];
    E.arr.forEach((w, idx) => {
      const f = frameOf(idx); if (!f || w.dim === false || !onPage(w)) return;   // dim:false = overlays (alerts)
      const r = rectOf(f.slot);
      const b = $c('div', 'ed-box' + (E.hidden.has(w.use) ? ' hidden' : '') + (E.sel === idx ? ' sel' : '') + (w.page != null ? ' paged' : ''));
      Object.assign(b.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      b.dataset.idx = idx; b.dataset.use = w.use;
      const tag = $c('div', 'ed-wtag');
      tag.appendChild($c('b', null, cat(w.use).name + (r.empty ? '（いまは表示なし）' : '')));
      if (Math.abs((w.scale || 1) - 1) > .001) tag.appendChild($c('span', 'pct', Math.round(w.scale * 100) + '%'));
      const sel = $c('select');                           // which page group
      sel.appendChild(new Option('常に表示', ''));
      const ps = pagesInUse(); if (!ps.length || (E.page != null && !ps.includes(E.page))) ps.push(E.page == null ? 0 : E.page);
      for (const p of [...new Set(ps)].sort((a, b) => a - b)) sel.appendChild(new Option(`ページ ${p + 1}`, String(p)));
      sel.value = w.page == null ? '' : String(w.page);
      sel.title = 'どのページに表示するか';
      sel.onpointerdown = ev => ev.stopPropagation();
      sel.onchange = () => { if (sel.value === '') delete w.page; else w.page = +sel.value; render(); };
      const eye = $c('i', null, E.hidden.has(w.use) ? '表示' : '隠す'), del = $c('i', null, '×');
      eye.title = '表示 / 非表示'; del.title = '削除（Delete キー）';
      eye.onpointerdown = ev => { ev.stopPropagation(); if (E.hidden.has(w.use)) E.hidden.delete(w.use); else E.hidden.add(w.use); render(); };
      del.onpointerdown = ev => { ev.stopPropagation(); E.arr.splice(idx, 1); E.sel = null; render(); };
      tag.append(sel, eye, del);
      b.appendChild(tag);
      b.onpointerdown = ev => dragWidget(ev, { idx });
      const hs = $c('div', 'ed-h scale'); hs.title = 'ドラッグで大きさ'; hs.onpointerdown = ev => resize(ev, idx, 'scale');
      const hw = $c('div', 'ed-h width'); hw.title = 'ドラッグで幅'; hw.onpointerdown = ev => resize(ev, idx, 'width');
      b.append(hs, hw);
      L.appendChild(b);
      if (!r.empty && !E.hidden.has(w.use)) drawn.push([b, r]);
    });
    for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {    // overlap warning
      const [a, ra] = drawn[i], [b, rb] = drawn[j];
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 3 && oy > 3) { a.classList.add('overlap'); b.classList.add('overlap'); }
    }
  }
  function drawTabs() {
    const t = E.tabs; if (!t) return;
    t.textContent = '';
    const tab = (label, p, title) => {
      const b = $c('button', E.page === p ? 'on' : '', label); if (title) b.title = title;
      b.onclick = () => { E.page = p; E.sel = null; O().showFreePage(p); drawAll(); };
      t.appendChild(b);
    };
    tab('常に表示', null, 'いつも表示するウィジェットだけを表示');
    for (const p of pagesInUse()) tab(String(p + 1), p, `ページ ${p + 1}（${O().cfg.pageSeconds || 30} 秒ごとに切り替わります）`);
    const add = $c('button', 'add', '＋ページ');
    add.onclick = () => { const ps = pagesInUse(); const n = ps.length ? ps[ps.length - 1] + 1 : 0; E.extraPages.add(n); E.page = n; O().showFreePage(n); drawAll(); };
    t.appendChild(add);
  }

  /* ---------------------------------------------------------------- snapping */
  function snapRect(r, ignoreIdx, useGrid) {
    // candidates: other visible widgets' edges / centres and the screen centre lines
    const xs = [innerWidth / 2], ys = [innerHeight / 2];
    E.arr.forEach((w, i) => {
      if (i === ignoreIdx || !onPage(w) || w.dim === false) return;
      const f = frameOf(i); if (!f) return; const q = f.slot.getBoundingClientRect(); if (q.height < 2) return;
      xs.push(q.left, q.right, q.left + q.width / 2); ys.push(q.top, q.bottom, q.top + q.height / 2);
    });
    let dx = null, dy = null, gx = null, gy = null;
    for (const edge of [r.left, r.right, r.left + r.width / 2])
      for (const x of xs) if (Math.abs(edge - x) < SNAP_PX && (dx === null || Math.abs(x - edge) < Math.abs(dx))) { dx = x - edge; gx = x; }
    for (const edge of [r.top, r.bottom, r.top + r.height / 2])
      for (const y of ys) if (Math.abs(edge - y) < SNAP_PX && (dy === null || Math.abs(y - edge) < Math.abs(dy))) { dy = y - edge; gy = y; }
    let left = r.left + (dx || 0), top = r.top + (dy || 0);
    if (useGrid && dx === null) left = snap(vw(left), .5) / 100 * innerWidth;
    if (useGrid && dy === null) top = snap(vh(top), .5) / 100 * innerHeight;
    E.guideX.style.display = gx === null ? 'none' : 'block'; if (gx !== null) E.guideX.style.left = gx + 'px';
    E.guideY.style.display = gy === null ? 'none' : 'block'; if (gy !== null) E.guideY.style.top = gy + 'px';
    return R(left, top, r.width, r.height);
  }
  const hideGuides = () => { E.guideX.style.display = E.guideY.style.display = 'none'; };

  /* ---------------------------------------------------------------- move / add / remove / size */
  function placeLive(w, f, r) {
    w.position.anchor = anchorFor(r);
    Object.assign(w.position, offsetsFor(w.position.anchor, r));
    const st = f.slot.style; for (const p of ['left', 'right', 'top', 'bottom', 'transform']) st[p] = '';
    O().place(f.slot, w.position);
  }
  const overPalette = ev => { if (!E.palette) return false; const p = E.palette.getBoundingClientRect(); return ev.clientX >= p.left && ev.clientX <= p.right && ev.clientY >= p.top && ev.clientY <= p.bottom; };
  function dragWidget(e, src) {      // src: {idx} existing widget, or {add: catalogId} from the palette
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    const w = src.idx != null ? E.arr[src.idx] : null, f = src.idx != null ? frameOf(src.idx) : null;
    const r0 = f ? rectOf(f.slot) : null;
    let moved = false, onPal = false;
    const ghost = src.add ? $c('div', 'ed-ghost', cat(src.add).name) : null;
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) { moved = true; if (ghost) E.layer.appendChild(ghost); if (src.idx != null) E.sel = src.idx; }
      onPal = overPalette(ev);
      E.palette.classList.toggle('drop', onPal && !!w);
      if (ghost) Object.assign(ghost.style, { left: ev.clientX + 12 + 'px', top: ev.clientY + 12 + 'px' });
      if (w && f) placeLive(w, f, snapRect(R(r0.left + ev.clientX - x0, r0.top + ev.clientY - y0, r0.width, r0.height), src.idx, E.grid && !ev.altKey));
      drawBoxes();
    };
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      hideGuides(); if (ghost) ghost.remove(); E.palette.classList.remove('drop');
      if (!moved) { if (src.idx != null) { E.sel = src.idx; drawBoxes(); } return; }
      if (w && onPal) { E.arr.splice(src.idx, 1); E.sel = null; render(); return; }
      if (src.add && !onPal) addAt(src.add, ev.clientX, ev.clientY);
      else drawBoxes();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  function addAt(id, x, y) {
    const c = cat(id), ds = c.defaultSize || {};
    const width = ds.width && ds.width !== 'auto' ? ds.width : 'auto';
    const r = R(x - 150, y - 50, 300, 100), anchor = anchorFor(r);
    const w = { use: id, settings: clone(c.settings), scale: 1, position: Object.assign({ anchor, width, height: 'auto', z: 0 }, offsetsFor(anchor, r)) };
    if (E.page != null) w.page = E.page;
    E.arr.push(w); E.sel = E.arr.length - 1; render();
  }
  function resize(e, idx, mode) {
    e.preventDefault(); e.stopPropagation();
    const w = E.arr[idx], f = frameOf(idx), r0 = f.slot.getBoundingClientRect(), x0 = e.clientX, s0 = w.scale || 1;
    const W0 = Math.max(r0.width, 60);
    const move = ev => {
      const g = E.grid && !ev.altKey, dx = ev.clientX - x0;
      if (mode === 'scale') {
        let k = s0 * Math.max(.2, (W0 + dx) / W0); k = Math.min(3, Math.max(.4, g ? snap(k, .05) : k));
        w.scale = +k.toFixed(3); f.scale = w.scale;
        if (f.ready) O().send(f, { type: 'theme', theme: O().themeMsg(), viewport: O().viewport(), scale: f.scale });
      } else {
        let v = vw(Math.max(80, W0 + dx)) / s0; if (g) v = snap(v, .5);
        w.position.width = v.toFixed(1) + 'vw';
      }
      if (w.position.width !== 'auto') f.iframe.style.width = O().scaled(w.position.width, w.scale || 1);
      const r = f.slot.getBoundingClientRect(); placeLive(w, f, R(r0.left, r0.top, r.width, r.height));   // keep the top-left
      drawBoxes();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); setTimeout(drawBoxes, 400); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  /* ---------------------------------------------------------------- palette, toolbar */
  function buildPalette() {
    const p = $c('div', 'ed-palette closed');
    const tab = $c('div', 'ed-ptab', '＋ ウィジェット');
    tab.onclick = () => p.classList.toggle('closed');
    const head = $c('div', 'ed-phead'), close = $c('button', null, '閉じる');
    close.onclick = () => p.classList.add('closed');
    head.append($c('b', null, 'ウィジェットを追加'), close, $c('span', null, 'デスクトップへドラッグ / ＋で中央に追加（いま選んでいるページへ）。ウィジェットをここへドロップすると削除'));
    p.append(tab, head);
    const list = $c('div', 'ed-plist');
    const used = new Set(E.arr.map(w => w.use));
    for (const c of catalog()) {
      if (c.id === 'alerts') continue;
      const it = $c('div', 'ed-pitem'), t = $c('div', 'ed-ptext');
      t.appendChild($c('b', null, c.name));
      if (c.description) t.appendChild($c('small', null, c.description));
      const notes = [];
      if (used.has(c.id)) notes.push('配置済み');
      if (c.providersOff.length) notes.push('データ源がオフ: ' + c.providersOff.join(', '));
      if (c.unofficial) notes.push('非公式');
      if (notes.length) t.appendChild($c('em', null, notes.join(' · ')));
      const add = $c('button', null, '＋');
      add.onclick = ev => { ev.stopPropagation(); p.classList.add('closed'); addAt(c.id, innerWidth / 2, innerHeight / 2); };
      it.append(t, add);
      it.onpointerdown = ev => { if (ev.target !== add) { p.classList.add('closed'); dragWidget(ev, { add: c.id }); } };
      list.appendChild(it);
    }
    p.appendChild(list);
    return p;
  }
  function toHost(msg) { try { window.webkit.messageHandlers.orbit.postMessage(msg); return true; } catch (e) { return false; } }
  function serialize() {
    const used = pagesInUse().filter(p => E.arr.some(w => w.page === p));       // compact: empty pages disappear
    const widgets = clone(E.arr).map(w => {
      if (w.page != null) w.page = used.indexOf(w.page);
      if (w.scale === 1) delete w.scale;
      return w;
    });
    return { zones: {}, widgets };
  }
  function save() {
    if (!toHost({ type: 'saveArrangement', arrangement: serialize(), hidden: [...E.hidden].sort() })) alert('保存は Orbit Desktop.app の中でのみできます');
  }
  function buildBar() {
    const bar = $c('div', 'ed-bar');
    bar.appendChild($c('b', null, 'レイアウト編集'));
    E.tabs = $c('span', 'ed-tabs'); bar.appendChild(E.tabs);
    const btn = (label, fn, cls) => { const b = $c('button', cls || '', label); b.onclick = fn; bar.appendChild(b); return b; };
    btn('プレビュー', () => setPreview(!document.body.classList.contains('ed-preview'))).title = 'Space を押している間もプレビュー';
    btn('グリッド', () => { E.grid = !E.grid; E.layer.classList.toggle('grid', E.grid); });
    btn('初期配置に戻す', () => {
      if (confirm('layout.yaml の初期配置に戻しますか？（GUI で変えた配置は消えます）')) toHost({ type: 'saveArrangement', arrangement: null, hidden: [...E.hidden].sort() }) || location.reload();
    });
    btn('キャンセル', () => { if (!toHost({ type: 'exitEdit' })) toggle(false); });
    btn('保存', save, 'primary');
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
    E.hidden = new Set(O().cfg.hidden || []); E.sel = null; E.extraPages = new Set();
    E.arr = fromConfig();
    E.converted = convertZones(E.arr);                  // measured from the current rendering, before re-render
    E.page = (() => { const ps = pagesInUse(); return ps.length ? ps[0] : null; })();
    E.layer = $c('div', 'ed-layer' + (E.grid ? ' grid' : '')); E.layer.id = 'editor';
    E.guideX = $c('div', 'ed-guide x'); E.guideY = $c('div', 'ed-guide y'); E.layer.append(E.guideX, E.guideY);
    E.palette = buildPalette();
    document.body.append(E.layer, E.palette, buildBar());
    render();
    E.timer = setInterval(() => { if (!document.body.classList.contains('ed-preview')) drawBoxes(); }, 700);
  }
  addEventListener('keydown', e => {
    if (!E.active || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space' && !e.repeat) { setPreview(true); e.preventDefault(); }
    else if (e.key === 'Escape') { if (!toHost({ type: 'exitEdit' })) toggle(false); }
    else if (e.key === 'Enter') save();
    else if ((e.key === 'Backspace' || e.key === 'Delete') && E.sel != null) { E.arr.splice(E.sel, 1); E.sel = null; render(); }
    else if (E.sel != null && e.key.startsWith('Arrow')) {         // nudge by 0.1 vw / vh (⇧: 1)
      const w = E.arr[E.sel], f = frameOf(E.sel); if (!f) return;
      const r = f.slot.getBoundingClientRect(), d = e.shiftKey ? 1 : .1;
      const dx = (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0) * innerWidth / 100;
      const dy = (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0) * innerHeight / 100;
      placeLive(w, f, R(r.left + dx, r.top + dy, r.width, r.height)); drawBoxes(); e.preventDefault();
    }
  });
  addEventListener('keyup', e => { if (E.active && e.code === 'Space') setPreview(false); });
  window.OrbitEditor = { toggle, serialize, get active() { return E.active; } };
})();
