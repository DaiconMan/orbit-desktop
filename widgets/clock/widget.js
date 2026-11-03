/* Clock: big thin time + date (theme.locale / theme.hour12, or the widget's own format / date_style),
   plus the meeting countdown under the date: during an event "会議中 · <title> · 残り N分", else the next
   event starting within `meeting_lead` minutes. */
(() => {
  let evs = [], el = {}, ctxRef = null;
  const L = {
    ja: { during: '会議中 ·', left: m => `· 残り ${m}分`, until: m => `まで ${m}分` },
    en: { during: 'IN MEETING ·', left: m => `· ${m} min left`, until: m => `in ${m} min` },
  };
  const WEIGHT = { thin: 200, light: 300, regular: 400, medium: 500 };
  const min = ms => Math.max(1, Math.ceil(ms / 60e3));
  const pad = n => String(n).padStart(2, '0');
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
  // show_date: false is the legacy way of saying date_style: none
  const dateStyle = s => (s.show_date === false ? 'none' : s.date_style || 'long');
  function hour12(ctx) {
    const f = ctx.settings.format;
    return f === '12h' ? true : f === '24h' ? false : ctx.hour12;
  }
  function timeHTML(d, ctx) {
    const h12 = hour12(ctx);
    // 12-hour: no leading zero ("午後3:15", "3:15 PM") and a smaller AM/PM; 24-hour as before ("09:05")
    const opts = { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: h12 };
    if (ctx.settings.seconds) opts.second = '2-digit';
    if (!h12) return ctx.esc(d.toLocaleTimeString(ctx.locale, opts));
    const parts = new Intl.DateTimeFormat(ctx.locale, opts).formatToParts(d);
    return parts.map((p, i) => p.type !== 'dayPeriod' ? ctx.esc(p.value)
      : `<span class="ap ${i ? 'post' : 'pre'}">${ctx.esc(p.value.trim())}</span>`).join('');
  }
  function dateText(d, ctx, style) {
    if (style === 'numeric') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (style === 'short') {
      const md = d.toLocaleDateString(ctx.locale, { month: 'numeric', day: 'numeric' });
      return `${md} (${d.toLocaleDateString(ctx.locale, { weekday: 'short' })})`;
    }
    return d.toLocaleDateString(ctx.locale, { month: 'long', day: 'numeric', weekday: 'long' });
  }
  Orbit.widget({
    mount(ctx) {
      ctxRef = ctx;
      const s = ctx.settings;
      ctx.root.innerHTML = '<div class="idle"><div class="clock"></div><div class="date"></div><div class="mtg"></div></div>';
      for (const k of ['idle', 'clock', 'date', 'mtg']) el[k] = ctx.root.querySelector('.' + k);
      ctx.root.style.setProperty('--size', s.size);
      ctx.root.style.setProperty('--weight', WEIGHT[s.weight] || 200);
      el.idle.classList.toggle('accent', s.color === 'accent');
      el.date.hidden = dateStyle(s) === 'none';
      el.mtg.hidden = !s.meeting;
      requestAnimationFrame(() => el.idle.classList.add('on'));   // 2 s fade in, as in the prototype
    },
    on: {
      time(t, ctx) {
        const d = new Date(t.now), style = dateStyle(ctx.settings);
        el.clock.innerHTML = timeHTML(d, ctx);
        if (style !== 'none') el.date.textContent = dateText(d, ctx, style);
        meeting(t.now);
      },
      calendar(c) { evs = Array.isArray(c && c.events) ? c.events : []; meeting(Date.now()); },
    },
  });
})();
