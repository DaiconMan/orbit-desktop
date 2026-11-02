/* MONTH: month calendar with today, public holidays and dots on days that have events.
   Ported from the prototype wallpaper's "month" module. */
(() => {
  'use strict';
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const U = Orbit.ui, esc = U.esc, WD = U.WD, n = new Date();
    const hol = (C.signals.holidays && C.signals.holidays.map) || {}, evs = (C.signals.calendar && C.signals.calendar.events) || [], evd = new Set();
    const holNames = new Set(Object.values(hol));
    if (C.settings.event_dots) for (const e of evs) {
      if (!e || !e.start) continue;
      if (e.allDay && holNames.has(e.title)) continue;            // holiday calendars duplicate the holiday map
      const a = new Date(e.start), b = new Date(e.allDay ? +new Date(e.end || e.start) - 1 : e.start);
      if (isNaN(a) || isNaN(b)) continue;
      for (let d = new Date(a.getFullYear(), a.getMonth(), a.getDate()), i = 0; d <= b && i < 62; d.setDate(d.getDate() + 1), i++) evd.add(U.ymd(d));
    }
    const key = U.ymd(n) + [...evd].join() + JSON.stringify(hol); if (key === lastKey) return; lastKey = key;
    const y = n.getFullYear(), mo = n.getMonth(), first = new Date(y, mo, 1), start = new Date(first); start.setDate(1 - first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(y, mo + 1, 0).getDate()) / 7), today = U.ymd(n), d0 = U.day0();
    let h = WD.map(w => `<span class="w">${w}</span>`).join('');
    for (let i = 0, d = new Date(start); i < weeks * 7; i++, d.setDate(d.getDate() + 1)) {
      const k = U.ymd(d), cls = ['d', d.getMonth() !== mo ? 'o' : '', d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '', hol[k] ? 'hol' : '',
        k === today ? 'today' : d < d0 ? 'past' : ''].filter(Boolean).join(' ');
      h += `<span class="${cls}"><span>${d.getDate()}</span>${evd.has(k) && d.getMonth() === mo ? '<i></i>' : ''}</span>`;
    }
    const pre = `${y}-${String(mo + 1).padStart(2, '0')}`;
    const hs = C.settings.holiday_list ? Object.entries(hol).filter(([k]) => k.startsWith(pre)).sort().map(([k, v]) => `${+k.slice(8)}日 ${esc(v)}`) : [];
    m.body.innerHTML = `<div class="mcal">${h}</div>${hs.length ? `<div class="foot" style="margin-top:calc(var(--vh) * 1.4)">${hs.join(' · ')}</div>` : ''}`;
    m.meta.textContent = `${y} · ${String(mo + 1).padStart(2, '0')}`;
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'MONTH', 'm-month'); render(); },
    on: { time() { render(); }, calendar() { render(); }, holidays() { render(); } },
  });
})();
