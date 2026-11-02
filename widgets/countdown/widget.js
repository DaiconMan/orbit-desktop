/* COUNTDOWN: next meeting, holiday, Claude weekly reset, meteor peak (ported from the prototype's COUNTDOWN module). */
(() => {
  const { esc, dur, day0 } = Orbit.ui;
  // annual meteor showers (IMO calendar; peak month/day), same list as the prototype's sky
  const SHOWERS = [['しぶんぎ座流星群', 1, 4], ['こと座流星群', 4, 22], ['みずがめ座η流星群', 5, 6], ['ペルセウス座流星群', 8, 13],
    ['オリオン座流星群', 10, 21], ['しし座流星群', 11, 17], ['ふたご座流星群', 12, 14], ['こぐま座流星群', 12, 22]];
  let m = null, lastMin = -1;
  function render(ctx) {
    const S = ctx.signals, now = Date.now(), rows = [];
    const evs = (S.calendar && S.calendar.events) || [];
    const nx = evs.filter(e => !e.allDay && e.status !== 'free' && +new Date(e.start) > now).sort((a, b) => new Date(a.start) - new Date(b.start))[0];
    if (nx) rows.push([esc(nx.title), dur(new Date(nx.start) - now)]);
    const hol = ((S.holidays || {}).upcoming || []).map(h => ({ ...h, t: new Date(h.date + 'T00:00:00') })).find(h => h.t >= day0());
    if (hol) rows.push([esc(hol.name), hol.t <= now ? '今日' : dur(hol.t - now)]);
    const wk = S.claudeUsage && (S.claudeUsage.rows || []).find(r => r.key === 'seven_day');
    if (wk && wk.resets) rows.push(['Claude 週リセット', dur(new Date(wk.resets) - now)]);
    if (ctx.settings.meteors) {
      const y = new Date().getFullYear(), pk = SHOWERS.map(([n, mo, d]) => ({ n, t: [y, y + 1].map(yy => new Date(yy, mo - 1, d, 22)).find(t => t > now) })).sort((a, b) => a.t - b.t)[0];
      if (pk) rows.push([`${pk.n} 極大`, dur(pk.t - now)]);
    }
    m.body.innerHTML = rows.map(([n, t]) => `<div class="cd"><span class="n">${n}</span><span class="t">${t}</span></div>`).join('');
    ctx.visible(rows.length > 0);
  }
  Orbit.widget({
    mount(ctx) { m = Orbit.module(ctx, 'COUNTDOWN', 'm-countdown'); render(ctx); },
    on: {
      time(t, ctx) { const mn = Math.floor(Date.now() / 60000); if (mn !== lastMin) { lastMin = mn; render(ctx); } },
      calendar: (d, c) => render(c), holidays: (d, c) => render(c), claudeUsage: (d, c) => render(c),
    },
  });
})();
