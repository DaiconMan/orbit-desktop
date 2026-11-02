/* Clock: big thin time + date (theme.locale / theme.hour12), plus the meeting countdown under the date:
   during an event "会議中 · <title> · 残り N分", else the next event starting within 15 min. */
(() => {
  let evs = [], el = {}, ctxRef = null;
  const L = {
    ja: { during: '会議中 ·', left: m => `· 残り ${m}分`, until: m => `まで ${m}分` },
    en: { during: 'IN MEETING ·', left: m => `· ${m} min left`, until: m => `in ${m} min` },
  };
  const min = ms => Math.max(1, Math.ceil(ms / 60e3));
  function meeting(now) {
    const ctx = ctxRef; if (!ctx || !ctx.settings.meeting) return;
    const esc = ctx.esc, l = L[ctx.lang] || L.en;
    const timed = evs.filter(e => e && !e.allDay && e.status !== 'free').map(e => ({ t: e.title, s: +new Date(e.start), e: +new Date(e.end) }));
    const cur = timed.filter(e => e.s <= now && e.e > now).sort((a, b) => a.e - b.e)[0];
    const nxt = timed.filter(e => e.s > now && e.s - now <= ctx.settings.meeting_lead * 60e3).sort((a, b) => a.s - b.s)[0];
    if (cur) el.mtg.innerHTML = `<i></i><span>${l.during}</span><b>${esc(cur.t)}</b><span>${l.left(min(cur.e - now))}</span>`;
    else if (nxt) el.mtg.innerHTML = `<i></i><b>${esc(nxt.t)}</b><span>${l.until(min(nxt.s - now))}</span>`;
    el.mtg.classList.toggle('on', !!(cur || nxt));
  }
  Orbit.widget({
    mount(ctx) {
      ctxRef = ctx;
      ctx.root.innerHTML = '<div class="idle"><div class="clock"></div><div class="date"></div><div class="mtg"></div></div>';
      for (const k of ['idle', 'clock', 'date', 'mtg']) el[k] = ctx.root.querySelector('.' + k);
      ctx.root.style.setProperty('--size', ctx.settings.size);
      el.date.hidden = !ctx.settings.show_date;
      el.mtg.hidden = !ctx.settings.meeting;
      requestAnimationFrame(() => el.idle.classList.add('on'));   // 2 s fade in, as in the prototype
    },
    on: {
      time(t, ctx) {
        const d = new Date(t.now);
        const opts = { hour: '2-digit', minute: '2-digit', hour12: ctx.hour12 };
        if (ctx.settings.seconds) opts.second = '2-digit';
        el.clock.textContent = d.toLocaleTimeString(ctx.locale, opts);
        el.date.textContent = d.toLocaleDateString(ctx.locale, { month: 'long', day: 'numeric', weekday: 'long' });
        meeting(t.now);
      },
      calendar(c) { evs = Array.isArray(c && c.events) ? c.events : []; meeting(Date.now()); },
    },
  });
})();
