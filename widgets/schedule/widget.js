/* Schedule gantt. Events come from the host's calendar provider (EventKit helper -> JSON);
   the widget only sees title, times, calendar name/colour, location, free/busy. */
(() => {
  let events = [], ctxRef = null;
  const L = {
    en: { none: 'No more events today', noMore: 'NO MORE EVENTS', next: (t, m) => `NEXT ${t} · in ${m} min` },
    ja: { none: 'この先の予定はありません', noMore: 'NO MORE EVENTS', next: (t, m) => `NEXT ${t} · ${m}分後` },
  };
  const safeColor = c => /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#7aa2ff';
  function render(now) {
    const ctx = ctxRef; if (!ctx) return;
    const s = ctx.settings, esc = ctx.esc, l = L[ctx.lang] || L.en;
    const from = now - s.hours_before * 3600e3, to = now + s.hours_after * 3600e3, span = to - from;
    const pct = ms => ((ms - from) / span * 100);
    const hm = d => d.toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit', hour12: ctx.hour12 });
    const allday = s.show_all_day ? events.filter(e => e.allDay && new Date(e.start) <= now && new Date(e.end) >= now) : [];
    const timed = events.filter(e => !e.allDay && new Date(e.end) > from && new Date(e.start) < to).slice(0, s.max_rows);
    let ax = '', grid = '';
    const h0 = new Date(from); h0.setMinutes(0, 0, 0);
    for (let h = h0.getTime() + 3600e3; h < to; h += 3600e3) {
      const p = pct(h); if (p < 2 || p > 98) continue;
      if (new Date(h).getHours() % 2 === 0) ax += `<span style="left:${p}%">${new Date(h).getHours()}</span>`;
      grid += `<div class="grid" style="left:${p}%"></div>`;
    }
    const rows = timed.map(e => {
      const st = new Date(e.start).getTime(), en = new Date(e.end).getTime();
      const lft = Math.max(0, pct(st)), r = Math.min(100, pct(en));
      const cls = st <= now && en > now ? 'now' : en <= now ? 'past' : '';
      const w = Math.max(1.5, r - lft), outside = w < 18 && lft > 30;   // short / right-edge bars: label on the left
      const label = `${esc(e.title)}<small>${hm(new Date(st))}–${hm(new Date(en))}</small>`;
      return `<div class="row"><div class="bar ${cls} ${outside ? 'lbl-left' : ''}" style="left:${lft}%;width:${w}%;border-color:${safeColor(e.color)}">${outside ? `<span class="out">${label}</span>` : label}</div></div>`;
    }).join('');
    const nextEv = events.find(e => !e.allDay && new Date(e.start) > now);
    const nextTxt = nextEv ? l.next(hm(new Date(nextEv.start)), Math.round((new Date(nextEv.start) - now) / 60000)) : l.noMore;
    ctx.root.firstChild.innerHTML = `<div class="hd"><span>${esc(s.title)}</span><span>${esc(nextTxt)}</span></div>
      ${allday.length ? `<div class="allday">${allday.map(e => `<span class="chip"><i style="background:${safeColor(e.color)}"></i>${esc(e.title)}</span>`).join('')}</div>` : ''}
      <div class="track">${grid}${rows || `<div class="empty">${esc(l.none)}</div>`}
        <div class="nowline" style="left:${pct(now)}%"></div><div class="axis">${ax}</div></div>`;
  }
  let lastRender = 0;
  Orbit.widget({
    mount(ctx) { ctxRef = ctx; ctx.root.innerHTML = `<div class="gantt ${ctx.settings.backdrop ? 'backdrop' : ''}"></div>`; render(Date.now()); },
    on: {
      calendar(c) { events = Array.isArray(c && c.events) ? c.events : []; render(Date.now()); lastRender = Date.now(); },
      time(t) { if (t.now - lastRender >= 30000) { lastRender = t.now; render(t.now); } },
    },
  });
})();
