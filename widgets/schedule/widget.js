/* Schedule: one-day horizontal timeline with leader-line labels (ported from the prototype).
   Axis at a fixed height; thin bars on it (overlaps -> lanes); each event gets a 1px leader rising to a
   two-line label (title / time). Labels are placed by a small cost search over
   {above rows 0-2, below rows 0-1} x {right of leader, left of leader}: never outside the widget, no
   overlaps, leaders avoid crossing other labels. Header: TODAY · all-day chips · NOW / NEXT.
   settings.demo renders a dense synthetic day for previewing (the prototype's ?cal=demo). */
(() => {
  let events = [], ctxRef = null, lastRender = 0;
  const L = {
    ja: { today: 'today', now: 'now', next: 'next', until: t => `${t}まで`, done: '今日の予定は終了', none: '予定なし',
      rel: m => m < 60 ? `${m}分後` : `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}後` },
    en: { today: 'today', now: 'now', next: 'next', until: t => `until ${t}`, done: 'No more events today', none: 'No events',
      rel: m => m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` },
  };
  const safeColor = c => /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#7aa2ff';
  function demoEvents() {
    const d = new Date(); d.setHours(0, 0, 0, 0); const T = h => new Date(d.getTime() + h * 3600e3).toISOString();
    const mk = (title, s, e, color = '#ff8d28', allDay = false) => ({ title, start: T(s), end: T(e), allDay, color, status: 'busy' });
    return [mk('新宿出社', 0, 24, '#ff8d28', true), mk('文化の日', 0, 24, '#83d754', true),
      mk('朝会', 9, 9.5), mk('担当進捗', 10, 11), mk('コンフィグレビュー', 10.5, 12, '#4f9cff'), mk('LBO(PAC) 臨時シス変レビュー（対象なしはスキップ）', 13, 14),
      mk('1on1', 14, 14.5, '#cb30e0'), mk('個別案件進捗', 15, 16), mk('デプロイ立会い', 17.5, 19, '#4f9cff'), mk('歯医者', 19.5, 20.5, '#83d754')];
  }
  function render(now) {
    const ctx = ctxRef; if (!ctx) return;
    const s = ctx.settings, esc = ctx.esc, l = L[ctx.lang] || L.en;
    const evs = s.demo ? demoEvents() : events;
    const vh = ctx.viewport.h / 100, vw = ctx.viewport.w / 100, bleed = s.bleed * vw, topPad = 2.5 * vh;
    const el = ctx.root.querySelector('.sched'), host = ctx.root;
    const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    const D0 = day0.getTime(), D1 = D0 + 864e5;
    const hm = d => d.toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit', hour12: ctx.hour12 });
    const seen = new Set();
    const allday = s.show_all_day ? evs.filter(e => e.allDay && +new Date(e.start) <= now && +new Date(e.end) >= now && !seen.has(e.title) && seen.add(e.title)) : [];
    const today = evs.filter(e => !e.allDay && +new Date(e.end) > D0 && +new Date(e.start) < D1)
      .map(e => Object.assign({}, e, { s: Math.max(D0, +new Date(e.start)), en: Math.min(D1, +new Date(e.end)) }))
      .sort((a, b) => a.s - b.s || a.en - b.en).slice(0, s.max_rows);
    // window: start_hour-end_hour by default, widened to hold every event and the current time
    const nowH = (now - D0) / 3600e3;
    let h0 = Math.min(s.start_hour, Math.floor(nowH)), h1 = Math.max(s.end_hour, Math.ceil(nowH + .02));
    for (const e of today) { h0 = Math.min(h0, Math.floor((e.s - D0) / 3600e3)); h1 = Math.max(h1, Math.ceil((e.en - D0) / 3600e3)); }
    h0 = Math.max(0, h0); h1 = Math.min(24, Math.max(h1, h0 + 6));
    const from = D0 + h0 * 3600e3, to = D0 + h1 * 3600e3, span = to - from;
    // geometry (px): the axis never moves; label rows stack upward from it
    const Wd = Math.max(10, host.clientWidth - 2 * bleed), X = ms => (ms - from) / span * Wd;
    el.style.left = bleed + 'px'; el.style.width = Wd + 'px'; el.style.top = topPad + 'px';
    const rowH = 3.6 * vh, laneH = .9 * vh, hdH = 4.2 * vh, hourZ = 2.8 * vh, maxA = 3, maxB = 2;
    const laneEnd = [];
    for (const e of today) { let k = laneEnd.findIndex(x => x <= e.s); if (k < 0) { k = laneEnd.length; laneEnd.push(0); } laneEnd[k] = e.en; e.lane = k; }
    const laneZ = Math.max(1, laneEnd.length) * laneH + 1.2 * vh;
    const lineY = hdH + maxA * rowH + laneZ, bodyH = lineY + hourZ + maxB * rowH;
    el.style.height = bodyH + 'px'; host.style.height = Math.ceil(topPad + bodyH) + 'px';
    for (const e of today) { e.cls = e.s <= now && e.en > now ? 'cur' : e.en <= now ? 'past' : ''; e.x = X(e.s); e.y = lineY - e.lane * laneH; }
    // measure label widths with the real fonts
    const meas = document.createElement('div'); meas.className = 'measure';
    meas.innerHTML = today.map(e => `<div class="lab"><b>${esc(e.title)}</b><small>${hm(new Date(e.s))}–${hm(new Date(e.en))}</small></div>`).join('');
    el.appendChild(meas); [...meas.children].forEach((c, i) => today[i].w = Math.ceil(c.getBoundingClientRect().width) + 2); meas.remove();
    // placement
    const pad = .9 * vh, gap = 1.4 * vh, rows = { a: [], b: [] }, leads = { a: [], b: [] };
    for (const e of today) {
      let best = null;
      for (const side of ['a', 'b']) for (let r = 0; r < (side === 'a' ? maxA : maxB); r++) for (const dir of ['r', 'l']) {
        const x0 = dir === 'r' ? e.x + pad : e.x - pad - e.w, x1 = x0 + e.w;
        if (x0 < -Math.min(vh, bleed) || x1 > Wd + Math.min(vh, bleed)) continue;                  // stay inside the frame
        if ((rows[side][r] || []).some(([a, b]) => x0 < b + gap && x1 > a - gap)) continue;           // overlaps a label in this row
        if (leads[side].some(q => q.r > r && q.x > x0 - gap * .5 && q.x < x1 + gap * .5)) continue;    // sits across someone's leader
        let cross = 0; for (let q = 0; q < r; q++) for (const [a, b] of rows[side][q] || []) if (e.x > a - gap * .5 && e.x < b + gap * .5) cross++;
        const cost = r * 3 + (side === 'b' ? 2 : 0) + (dir === 'l' ? 1 : 0) + cross * 20;
        if (!best || cost < best.cost) best = { side, r, dir, x0, x1, cost };
      }
      if (!best) {   // nothing fits: top row, keep it inside anyway
        const dir = e.x + pad + e.w <= Wd ? 'r' : 'l', x0 = dir === 'r' ? e.x + pad : Math.max(0, e.x - pad - e.w);
        best = { side: 'a', r: maxA - 1, dir, x0, x1: x0 + e.w };
      }
      (rows[best.side][best.r] || (rows[best.side][best.r] = [])).push([best.x0, best.x1]);
      leads[best.side].push({ x: e.x, r: best.r });
      Object.assign(e, best);
    }
    const usedA = today.reduce((m, e) => e.side === 'a' ? Math.max(m, e.r + 1) : m, 0);
    const usedB = today.reduce((m, e) => e.side === 'b' ? Math.max(m, e.r + 1) : m, 0);
    // header: TODAY · all-day chips · NOW / NEXT with countdown
    const cur = today.find(e => e.cls === 'cur'), nxt = today.find(e => e.s > now);
    let right = '';
    if (cur) right += `<span class="it"><span class="eb">${l.now}</span><b>${esc(cur.title)}</b><span class="tm">${esc(l.until(hm(new Date(cur.en))))}</span></span>`;
    if (nxt) right += `<span class="it"><span class="eb">${l.next}</span><b>${esc(nxt.title)}</b><span class="tm">${hm(new Date(nxt.s))} · ${esc(l.rel(Math.round((nxt.s - now) / 60000)))}</span></span>`;
    if (!cur && !nxt) right = `<span class="it"><span class="tm">${today.length ? l.done : l.none}</span></span>`;
    const chips = allday.map(e => `<span class="chip"><i style="background:${safeColor(e.color)}"></i>${esc(e.title)}</span>`).join('');
    const hdTop = lineY - laneZ - usedA * rowH - hdH;
    let html = s.backdrop ? `<div class="scrim" style="left:${-bleed}px;right:${-bleed}px;top:${hdTop - 2.5 * vh}px;height:${lineY + hourZ + usedB * rowH + 2.5 * vh - hdTop}px"></div>` : '';
    html += `<div class="hd" style="top:${hdTop}px"><span class="eb">${esc(s.title)}</span>${chips}<span class="nx">${right}</span></div>
      <div class="line" style="top:${lineY}px"></div>`;
    // axis: ticks every hour, numbers every 2 h (3 h on long days), hidden where a leader or the now mark passes
    const step = h1 - h0 > 14 ? 3 : 2, nowIn = now >= from && now <= to;
    const hideX = today.filter(e => e.side === 'b').map(e => e.x).concat(nowIn ? [X(now)] : []);
    for (let h = h0; h <= h1; h++) {
      const x = X(D0 + h * 3600e3);
      html += `<i class="tick" style="left:${x}px;top:${lineY}px"></i>`;
      if (h % step === 0 && !hideX.some(hx => Math.abs(hx - x) < 3.4 * vh)) html += `<span class="hr" style="left:${x}px;top:${lineY + .9 * vh}px">${h}</span>`;
    }
    for (const e of today) {
      const c = safeColor(e.color), lf = X(e.s), w = Math.max(3, X(e.en) - lf);
      const labTop = e.side === 'a' ? lineY - laneZ - (e.r + 1) * rowH + .3 * vh : lineY + hourZ + e.r * rowH + .3 * vh;
      const lt = e.side === 'a' ? labTop : e.y, lh = e.side === 'a' ? e.y - labTop : labTop + 1.9 * vh - e.y;
      html += `<div class="seg ${e.cls}" style="left:${lf}px;width:${w}px;top:${e.y}px;background:${c};color:${c}"></div>
        <div class="lead ${e.cls}" style="left:${e.x}px;top:${lt}px;height:${lh}px;background:${c}"></div>
        <div class="lab ${e.cls} ${e.dir}" style="left:${e.x0}px;top:${labTop}px;width:${e.w}px"><b>${esc(e.title)}</b><small>${hm(new Date(e.s))}–${hm(new Date(e.en))}</small></div>`;
    }
    if (nowIn) {
      const x = X(now);
      html += `<div class="nowm" style="left:${x}px;top:${lineY - laneZ + .4 * vh}px;height:${laneZ + .2 * vh}px"></div><i class="nowdot" style="left:${x}px;top:${lineY}px"></i>
        <span class="hr now" style="left:${x}px;top:${lineY + .9 * vh}px">${hm(new Date(now))}</span>`;
    }
    el.innerHTML = html;
  }
  Orbit.widget({
    mount(ctx) { ctxRef = ctx; ctx.root.innerHTML = '<div class="sched"></div>'; ctx.root.style.position = 'relative'; render(Date.now()); lastRender = Date.now(); },
    on: {
      calendar(c) { events = Array.isArray(c && c.events) ? c.events : []; render(Date.now()); lastRender = Date.now(); },
      time(t) { if (t.now - lastRender >= 30000) { lastRender = t.now; render(t.now); } },
    },
    theme() { render(Date.now()); },
  });
})();
