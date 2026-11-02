/* WEEK: agenda for the coming days (tomorrow on; today lives in the schedule timeline).
   Ported from the prototype wallpaper's "week" module. Hidden when there is nothing coming up. */
(() => {
  'use strict';
  const safeColor = c => /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#ffffff';
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const U = Orbit.ui, esc = U.esc, WD = U.WD, set = C.settings;
    const t0 = U.day0(), t1 = new Date(t0); t1.setDate(t0.getDate() + 1 + set.days);
    const from = new Date(t0); from.setDate(t0.getDate() + (set.include_today ? 0 : 1));
    const hol = (C.signals.holidays && C.signals.holidays.map) || {}, evs = (C.signals.calendar && C.signals.calendar.events) || [];
    const days = new Map(), seen = new Set();
    for (const e of evs) {
      if (!e || !e.start) continue;
      const st = new Date(e.start); if (isNaN(st) || st < from || st >= t1) continue;
      const dk = U.ymd(st); if (e.allDay && hol[dk] === e.title) continue;
      const sig = dk + e.title + e.start; if (seen.has(sig)) continue; seen.add(sig);
      (days.get(dk) || days.set(dk, []).get(dk)).push(e);
    }
    const key = [...days.entries()].map(([k, v]) => k + v.map(e => e.title + e.start + e.color).join()).join('|') + U.ymd(t0) + JSON.stringify(hol);
    if (key === lastKey) return; lastKey = key;
    if (!days.size) { C.visible(false); return; }
    const max = set.max_rows;
    let h = '', rows = 0;
    for (const [dk, list] of [...days.entries()].sort()) {
      if (rows >= max) break;
      const d = new Date(dk + 'T00:00:00'), dd = Math.round((d - t0) / 864e5);
      list.sort((a, b) => (b.allDay - a.allDay) || (new Date(a.start) - new Date(b.start)));
      h += `<div class="dy"><b>${d.getMonth() + 1}/${d.getDate()} ${WD[d.getDay()]}</b><span>${U.dayWord(dd)}</span>${hol[dk] ? `<span class="hol">${esc(hol[dk])}</span>` : ''}</div>`;
      const show = list.slice(0, Math.max(1, max - rows - 1)); rows += 1 + show.length;
      h += show.map(e => `<div class="ev"><span class="tm">${e.allDay ? '終日' : new Date(e.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span><span class="n"><i style="background:${safeColor(e.color)}"></i>${esc(e.title)}</span></div>`).join('');
      if (list.length > show.length) h += `<div class="more">ほか ${list.length - show.length} 件</div>`;
    }
    m.body.innerHTML = `<div class="agd">${h}</div>`;
    const last = [...days.keys()].sort().pop(); m.meta.textContent = `〜 ${+last.slice(5, 7)}/${+last.slice(8)}`;
    C.visible(true);
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'WEEK', 'm-week'); render(); },
    on: { time() { render(); }, calendar() { render(); }, holidays() { render(); } },
  });
})();
