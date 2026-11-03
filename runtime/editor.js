/* Orbit Desktop layout editor (trusted page code, like host.js).
 *
 * Opened from the host app's menu (window.orbitEdit(true)). It works on a copy of the arrangement
 * (zones + widgets) and re-renders the real widgets as you edit, so what you see is what you get:
 *   - drag a widget to another zone / page / column, out of a zone (free placement) or onto the
 *     palette (remove); drag a zone to move it
 *   - corner handle = size (zones and free widgets), zone right / bottom edge = width / height
 *   - palette (left): every installed widget; drag it onto the desktop or click ＋
 *   - ◀ ▶ / ＋ページ on paged zones; hold Space (or プレビュー) to see the result without the editor
 * 保存 sends {type: 'saveArrangement'} to the host app (WKScriptMessageHandler `orbit`), which stores it in
 * ~/.config/orbit-desktop/settings.json. layout.yaml stays untouched and is the 初期配置.
 */
(() => {
  'use strict';
  const O = () => window.__orbit;
  const E = { active: false, arr: null, hidden: new Set(), grid: true, sel: null, layer: null, pages: {}, dirty: false };
  const $c = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const vw = px => px / innerWidth * 100, vh = px => px / innerHeight * 100;
  const snap = (v, step) => Math.round(v / step) * step;
  const clone = o => JSON.parse(JSON.stringify(o));
  const ZONE_KEYS = ['anchor', 'x', 'y', 'width', 'height', 'gap', 'columns', 'column_gap', 'rotate_seconds', 'scale'];

  /* ---------------------------------------------------------------- model */
  // Japanese names for the bundled widgets (others show their manifest name)
  const JA = { weather: '天気', load: '負荷', homenet: '自宅ネットワーク', tonight: '今夜の空', sky: '星図', life: '暮らし',
    ops: '開発・運用', mac: 'Mac', countdown: 'カウントダウン', world: '世界時計', progress: '進み具合', contrib: 'GitHub ヒートマップ',
    month: '月カレンダー', week: '今週の予定', recent: '最近の曲', news: 'ニュース', rain: '雨（2時間）', pressure: '気圧',
    bluetooth: 'Bluetooth 機器', onthisday: '今日は何の日', launches: 'ロケット打ち上げ', kp: '宇宙天気（Kp）',
    'now-playing': '再生中の曲', clock: '時計', schedule: '予定', alerts: '緊急地震速報・津波', 'system-stats': 'システム情報',
    'claude-usage': 'Claude 残量' };
  const lang = () => ((O().cfg.theme || {}).locale || navigator.language || '').toLowerCase();
  const catalog = () => (O().cfg.catalog || []).map(c => Object.assign({}, c, { name: lang().startsWith('en') ? c.name : (JA[c.id] || c.name) }));
  const cat = id => catalog().find(c => c.id === id) || { id, name: id, needs: [], assets: [], settings: {} };
  function fromConfig() {
    const cfg = O().cfg, zones = {};
    for (const [n, z] of Object.entries(cfg.zones || {})) { zones[n] = {}; for (const k of ZONE_KEYS) if (z[k] != null) zones[n][k] = z[k]; }
    const widgets = (cfg.allWidgets || cfg.widgets).map(w => {
      const o = { use: w.use, settings: clone(w.settings || {}) };
      if (w.dim === false) o.dim = false;
      if (w.zone) Object.assign(o, { zone: w.zone, page: w.page || 0, column: w.column || 0 });
      else Object.assign(o, { position: clone(w.position), scale: w.scale || 1 });
      return o;
    });
    return { zones, widgets };
  }
  function resolved() {   // arrangement -> the shape host.js renders (like /api/config widgets)
    return E.arr.widgets.map(w => {
      const c = cat(w.use);
      return { use: w.use, name: c.name, needs: c.needs, assets: c.assets, settings: w.settings || clone(c.settings),
        zone: w.zone || null, page: w.page || 0, column: w.column || 0, dim: w.dim !== false, scale: w.scale || 1,
        position: w.position || { anchor: 'center', x: 0, y: 0, width: 'auto', height: 'auto', z: 0 } };
    });
  }
  function render() {
    const keepPage = {};
    for (const [n, Z] of Object.entries(O().zoneEls)) keepPage[n] = Z.cur;
    O().renderLayout(clone(E.arr.zones), resolved());
    for (const [n, Z] of Object.entries(O().zoneEls)) {
      if (!Z.paged) continue;
      const want = Math.max(E.pages[n] || 0, Z.pages.length || 1);
      while (Z.pages.length < want) {           // empty pages added with ＋ページ
        const p = $c('div', 'page');
        for (let c = 0; c < Z.z.columns; c++) p.appendChild($c('div', 'col'));
        Z.el.appendChild(p); Z.pages.push(p);
      }
      E.pages[n] = Z.pages.length;
      if (Z.dots) Z.dots.remove(), Z.dots = null;
      O().showPage(Z, Math.min(keepPage[n] || 0, Z.pages.length - 1));
    }
    for (const s of document.querySelectorAll('#widgets .slot')) s.classList.toggle('ed-hidden', E.hidden.has(s.dataset.widget));
    E.dirty = true;
    drawBoxes();
  }

  /* ---------------------------------------------------------------- geometry */
  function offsetsFor(anchor, r) {
    const [v, h] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
    const W = innerWidth, H = innerHeight;
    const x = h === 'left' ? r.left : h === 'right' ? W - r.right : r.left + r.width / 2 - W / 2;
    const y = v === 'top' ? r.top : v === 'bottom' ? H - r.bottom : r.top + r.height / 2 - H / 2;
    return { x: vw(x).toFixed(2) + 'vw', y: vh(y).toFixed(2) + 'vh' };
  }
  const anchorAt = (x, y) => (y < innerHeight / 3 ? 'top' : y > innerHeight * 2 / 3 ? 'bottom' : 'center') + '-' +
    (x < innerWidth / 3 ? 'left' : x > innerWidth * 2 / 3 ? 'right' : 'center');
  const fixAnchor = a => a === 'center-center' ? 'center' : a;
  const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return r.height < 2 ? { left: r.left, top: r.top, right: r.left + Math.max(r.width, 160), bottom: r.top + 30, width: Math.max(r.width, 160), height: 30, empty: true } : r;
  }

  /* ---------------------------------------------------------------- overlay */
  function frameOf(idx) { return O().frames.find(f => f.kind === 'widget' && f.idx === idx && !f.dead); }
  function drawBoxes() {
    const L = E.layer; if (!L) return;
    L.querySelectorAll('.ed-box').forEach(b => b.remove());
    for (const [name, Z] of Object.entries(O().zoneEls)) {
      const r = rectOf(Z.el), b = $c('div', 'ed-box zone');
      Object.assign(b.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: Math.max(r.height, 40) + 'px' });
      const tag = $c('div', 'ed-tag');
      tag.appendChild($c('b', null, 'ゾーン ' + name));
      if (Z.paged) {
        const prev = $c('i', null, '◀'), next = $c('i', null, '▶'), add = $c('i', null, '＋ページ');
        prev.onpointerdown = ev => { ev.stopPropagation(); O().showPage(Z, (Z.cur - 1 + Z.pages.length) % Z.pages.length); drawBoxes(); };
        next.onpointerdown = ev => { ev.stopPropagation(); O().showPage(Z, (Z.cur + 1) % Z.pages.length); drawBoxes(); };
        add.onpointerdown = ev => { ev.stopPropagation(); E.pages[name] = Z.pages.length + 1; render(); O().showPage(Z, Z.pages.length - 1); drawBoxes(); };
        tag.append(prev, $c('span', null, `${Z.cur + 1} / ${Z.pages.length}`), next, add);
      }
      tag.appendChild($c('span', 'pct', Math.round((E.arr.zones[name].scale || 1) * 100) + '%'));
      b.appendChild(tag);
      b.onpointerdown = ev => dragZone(ev, name, 'move');
      const hs = [['ed-h scale', 'scale'], ['ed-h width', 'width']];
      if (Z.paged) hs.push(['ed-h height', 'height']);
      for (const [cls, mode] of hs) { const h = $c('div', cls); h.onpointerdown = ev => dragZone(ev, name, mode); b.appendChild(h); }
      L.appendChild(b);
    }
    E.arr.widgets.forEach((w, idx) => {
      const f = frameOf(idx); if (!f || w.dim === false) return;     // dim:false = overlays (alerts): not editable
      if (w.zone) {                                       // only widgets on the zone's visible page
        const Z = O().zoneEls[w.zone];
        if (Z && Z.paged && (w.page || 0) !== Z.cur) return;
      }
      const r = rectOf(f.slot), b = $c('div', 'ed-box widget' + (w.zone ? ' zoned' : ' free') + (E.hidden.has(w.use) ? ' hidden' : '') + (E.sel === idx ? ' sel' : ''));
      Object.assign(b.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      const tag = $c('div', 'ed-wtag');
      tag.appendChild($c('b', null, cat(w.use).name + (r.empty ? '（いまは表示なし）' : '')));
      const eye = $c('i', null, E.hidden.has(w.use) ? '表示' : '隠す'), del = $c('i', null, '×');
      eye.title = '表示 / 非表示'; del.title = '削除';
      eye.onpointerdown = ev => { ev.stopPropagation(); if (E.hidden.has(w.use)) E.hidden.delete(w.use); else E.hidden.add(w.use); render(); };
      del.onpointerdown = ev => { ev.stopPropagation(); E.arr.widgets.splice(idx, 1); E.sel = null; render(); };
      tag.append(eye, del);
      b.appendChild(tag);
      b.dataset.idx = idx; b.dataset.use = w.use;
      b.onpointerdown = ev => dragWidget(ev, { idx });
      if (!w.zone) { const h = $c('div', 'ed-h scale'); h.onpointerdown = ev => scaleWidget(ev, idx); b.appendChild(h); }
      L.appendChild(b);
    });
  }

  /* ---------------------------------------------------------------- zones: move / size */
  function dragZone(e, name, mode) {
    e.preventDefault(); e.stopPropagation();
    const Z = O().zoneEls[name], z = E.arr.zones[name], r0 = Z.el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, s0 = z.scale || 1;
    const move = ev => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0, g = E.grid && !ev.altKey;
      if (mode === 'move') {
        let left = r0.left + dx, top = r0.top + dy;
        if (g) { left = snap(vw(left), .5) / 100 * innerWidth; top = snap(vh(top), .5) / 100 * innerHeight; }
        Object.assign(z, offsetsFor(z.anchor || 'top-left', { left, top, width: r0.width, height: r0.height, right: left + r0.width, bottom: top + r0.height }));
      } else if (mode === 'scale') {
        let k = s0 * Math.max(.2, (r0.width + dx) / r0.width); k = Math.min(2.5, Math.max(.5, g ? snap(k, .05) : k));
        z.scale = +k.toFixed(3);
      } else if (mode === 'width') {
        let v = vw(Math.max(80, r0.width + dx)) / s0; if (g) v = snap(v, .5); z.width = v.toFixed(1) + 'vw';
      } else {
        let v = vh(Math.max(60, r0.height + dy)) / s0; if (g) v = snap(v, .5); z.height = v.toFixed(1) + 'vh';
      }
      Object.assign(Z.z, z); O().styleZone(Z);
      if (mode === 'scale') for (const f of O().frames) if (f.zone === name && f.ready) { f.scale = z.scale; O().send(f, { type: 'theme', theme: O().themeMsg(), viewport: O().viewport(), scale: f.scale }); }
      drawBoxes();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); E.dirty = true; setTimeout(drawBoxes, 400); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  /* ---------------------------------------------------------------- free widgets: size */
  function scaleWidget(e, idx) {
    e.preventDefault(); e.stopPropagation();
    const w = E.arr.widgets[idx], f = frameOf(idx), r0 = f.slot.getBoundingClientRect(), x0 = e.clientX, s0 = w.scale || 1;
    const move = ev => {
      const g = E.grid && !ev.altKey;
      let k = s0 * Math.max(.2, (Math.max(r0.width, 60) + ev.clientX - x0) / Math.max(r0.width, 60));
      k = Math.min(2.5, Math.max(.5, g ? snap(k, .05) : k)); w.scale = +k.toFixed(3);
      f.scale = w.scale; if (f.ready) O().send(f, { type: 'theme', theme: O().themeMsg(), viewport: O().viewport(), scale: f.scale });
      if (w.position.width !== 'auto') f.iframe.style.width = O().scaled(w.position.width, w.scale);
      drawBoxes();
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); E.dirty = true; setTimeout(drawBoxes, 400); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  /* ---------------------------------------------------------------- widgets: move between zones / free / remove */
  function dropTarget(x, y, ignoreIdx) {
    if (E.palette && inside(E.palette.getBoundingClientRect(), x, y)) { E.palette.classList.add('drop'); return { remove: true }; }
    if (E.palette) E.palette.classList.remove('drop');
    for (const [name, Z] of Object.entries(O().zoneEls)) {
      const cols = Z.paged ? [...(Z.pages[Z.cur] || { children: [] }).children] : [Z.el];
      for (let c = 0; c < cols.length; c++) {
        const cr = cols[c].getBoundingClientRect(), zr = Z.el.getBoundingClientRect();
        const r = { left: cr.left, right: cr.right, top: zr.top, bottom: Math.max(zr.bottom, cr.bottom, zr.top + 60) };
        if (!inside(r, x, y)) continue;
        const slots = [...cols[c].querySelectorAll(':scope > .slot')].filter(s => +s.dataset.idx !== ignoreIdx && s.getBoundingClientRect().height > 1);
        let before = null, lineY = slots.length ? slots[slots.length - 1].getBoundingClientRect().bottom : r.top;
        for (const s of slots) { const sr = s.getBoundingClientRect(); if (y < sr.top + sr.height / 2) { before = +s.dataset.idx; lineY = sr.top; break; } }
        return { zone: name, page: Z.paged ? Z.cur : 0, column: Z.paged ? c : 0, before, after: slots.length ? +slots[slots.length - 1].dataset.idx : null, line: { left: cr.left, width: cr.width, top: lineY } };
      }
    }
    return { free: true };
  }
  function dragWidget(e, src) {      // src: {idx} existing widget, or {add: catalogId} from the palette
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    const w = src.idx != null ? E.arr.widgets[src.idx] : null, f = src.idx != null ? frameOf(src.idx) : null;
    const r0 = f ? rectOf(f.slot) : null;
    let moved = false, tgt = null;
    const ghost = $c('div', 'ed-ghost', cat(w ? w.use : src.add).name), line = $c('div', 'ed-line');
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) { moved = true; E.layer.append(ghost, line); if (src.idx != null) E.sel = src.idx; }
      Object.assign(ghost.style, { left: ev.clientX + 12 + 'px', top: ev.clientY + 12 + 'px' });
      tgt = dropTarget(ev.clientX, ev.clientY, src.idx);
      line.style.display = tgt.line ? 'block' : 'none';
      if (tgt.line) Object.assign(line.style, { left: tgt.line.left + 'px', width: tgt.line.width + 'px', top: tgt.line.top - 2 + 'px' });
      ghost.classList.toggle('remove', !!tgt.remove);
      ghost.dataset.hint = tgt.remove ? '削除' : tgt.zone ? `ゾーン ${tgt.zone}` : '自由配置';
      if (w && !w.zone && tgt.free && f) {          // free widget: move the real thing live
        const left = r0.left + ev.clientX - x0, top = r0.top + ev.clientY - y0;
        Object.assign(w.position, offsetsFor(w.position.anchor, { left, top, width: r0.width, height: r0.height, right: left + r0.width, bottom: top + r0.height }));
        const st = f.slot.style; for (const p of ['left', 'right', 'top', 'bottom', 'transform']) st[p] = '';
        O().place(f.slot, w.position);
      }
      drawBoxes();
    };
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      ghost.remove(); line.remove(); if (E.palette) E.palette.classList.remove('drop');
      if (!moved) { if (src.idx != null) { E.sel = src.idx; drawBoxes(); } else if (src.add) addFree(src.add, innerWidth / 2, innerHeight / 2); return; }
      if (!tgt) return;
      const item = w || { use: src.add, settings: clone(cat(src.add).settings) };
      if (tgt.remove) { if (src.idx != null) E.arr.widgets.splice(src.idx, 1); E.sel = null; render(); return; }
      if (tgt.free) {
        if (w && !w.zone) { E.dirty = true; return; }        // already moved live
        let gx = ev.clientX, gy = ev.clientY, g = E.grid && !ev.altKey;
        if (g) { gx = snap(vw(gx), .5) / 100 * innerWidth; gy = snap(vh(gy), .5) / 100 * innerHeight; }
        const anchor = fixAnchor(anchorAt(gx, gy)), wd = r0 ? r0.width : 300, ht = r0 ? r0.height : 120;
        const r = { left: gx - wd / 2, top: gy - ht / 2, width: wd, height: ht, right: gx + wd / 2, bottom: gy + ht / 2 };
        delete item.zone; delete item.page; delete item.column;
        item.position = Object.assign({ anchor, width: 'auto', height: 'auto', z: 0 }, offsetsFor(anchor, r));
        item.scale = item.scale || 1;
        if (src.idx == null) E.arr.widgets.push(item);
        render(); return;
      }
      // into a zone column, before `before` (or after the column's last widget)
      delete item.position; delete item.scale;
      Object.assign(item, { zone: tgt.zone, page: tgt.page, column: tgt.column });
      const list = E.arr.widgets;
      let from = src.idx != null ? src.idx : -1;
      let at = tgt.before != null ? tgt.before : tgt.after != null ? tgt.after + 1 : list.length;
      if (from >= 0) { list.splice(from, 1); if (from < at) at--; }
      list.splice(at, 0, item);
      E.sel = at; render();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
  function addFree(id, x, y) {
    const r = { left: x - 150, top: y - 60, width: 300, height: 120, right: x + 150, bottom: y + 60 };
    E.arr.widgets.push({ use: id, settings: clone(cat(id).settings), scale: 1,
      position: Object.assign({ anchor: 'center', width: 'auto', height: 'auto', z: 0 }, offsetsFor('center', r)) });
    E.sel = E.arr.widgets.length - 1; render();
  }

  /* ---------------------------------------------------------------- palette, toolbar */
  function buildPalette() {
    const p = $c('div', 'ed-palette closed');
    const tab = $c('div', 'ed-ptab', '＋ ウィジェット');
    tab.onclick = () => p.classList.toggle('closed');
    const head = $c('div', 'ed-phead'), close = $c('button', null, '閉じる');
    close.onclick = () => p.classList.add('closed');
    head.append($c('b', null, 'ウィジェットを追加'), close, $c('span', null, 'デスクトップへドラッグで配置 · ＋で中央に追加 · ウィジェットをここへドロップで削除'));
    p.append(tab, head);
    const list = $c('div', 'ed-plist');
    const used = new Set(E.arr.widgets.map(w => w.use));
    for (const c of catalog()) {
      if (c.id === 'alerts') continue;   // the alert overlay stays where it is
      const it = $c('div', 'ed-pitem'), t = $c('div', 'ed-ptext');
      t.appendChild($c('b', null, c.name));
      if (c.description) t.appendChild($c('small', null, c.description));
      const notes = [];
      if (used.has(c.id)) notes.push('配置済み');
      if (c.providersOff.length) notes.push('データ源がオフ: ' + c.providersOff.join(', '));
      if (c.unofficial) notes.push('非公式');
      if (notes.length) t.appendChild($c('em', null, notes.join(' · ')));
      const add = $c('button', null, '＋');
      add.onclick = ev => { ev.stopPropagation(); p.classList.add('closed'); addFree(c.id, innerWidth / 2, innerHeight / 2); };
      it.append(t, add);
      it.onpointerdown = ev => { if (ev.target !== add) { dragWidget(ev, { add: c.id }); p.classList.add('closed'); } };
      list.appendChild(it);
    }
    p.appendChild(list);
    return p;
  }
  function toHost(msg) { try { window.webkit.messageHandlers.orbit.postMessage(msg); return true; } catch (e) { return false; } }
  function serialize() {
    // compact page numbers per zone (empty pages disappear), keep zone keys the server knows
    const widgets = clone(E.arr.widgets);
    for (const name of Object.keys(E.arr.zones)) {
      const used = [...new Set(widgets.filter(w => w.zone === name).map(w => w.page || 0))].sort((a, b) => a - b);
      for (const w of widgets) if (w.zone === name) w.page = used.indexOf(w.page || 0);
    }
    for (const w of widgets) { if (w.zone) { delete w.position; delete w.scale; } else if (w.scale === 1) delete w.scale; }
    return { zones: clone(E.arr.zones), widgets };
  }
  function save() {
    if (!toHost({ type: 'saveArrangement', arrangement: serialize(), hidden: [...E.hidden].sort() })) alert('保存は Orbit Desktop.app の中でのみできます');
  }
  function buildBar() {
    const bar = $c('div', 'ed-bar');
    bar.appendChild($c('b', null, 'レイアウト編集'));
    const btn = (label, fn, cls) => { const b = $c('button', cls || '', label); b.onclick = fn; bar.appendChild(b); return b; };
    const pv = btn('プレビュー', () => setPreview(!document.body.classList.contains('ed-preview')));
    pv.title = 'Space を押している間もプレビューします';
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
  function toggle(on) {
    if (on === E.active || !O() || !O().cfg) return;
    if (!on) { location.reload(); return; }
    E.active = true;
    O().setRotationPaused(true);
    document.body.classList.add('editing');
    E.arr = fromConfig(); E.hidden = new Set(O().cfg.hidden || []); E.pages = {}; E.sel = null;
    E.layer = $c('div', 'ed-layer' + (E.grid ? ' grid' : '')); E.layer.id = 'editor';
    E.palette = buildPalette();
    document.body.append(E.layer, E.palette, buildBar());
    render();
    E.timer = setInterval(() => { if (!document.body.classList.contains('ed-preview')) drawBoxes(); }, 700);
  }
  addEventListener('keydown', e => {
    if (!E.active) return;
    if (e.code === 'Space' && !e.repeat) { setPreview(true); e.preventDefault(); }
    else if (e.key === 'Escape') { if (!toHost({ type: 'exitEdit' })) toggle(false); }
    else if (e.key === 'Enter') save();
    else if ((e.key === 'Backspace' || e.key === 'Delete') && E.sel != null) { E.arr.widgets.splice(E.sel, 1); E.sel = null; render(); }
  });
  addEventListener('keyup', e => { if (E.active && e.code === 'Space') setPreview(false); });
  window.OrbitEditor = { toggle, serialize, get active() { return E.active; } };
})();
