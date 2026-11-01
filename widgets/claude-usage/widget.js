/* UNOFFICIAL Claude usage meters. Shows remaining % per window and the reset time.
   Data: host provider claude_usage (opt-in), which forwards only {key, pct, resets}. */
(() => {
  const NAMES = { five_hour: '5H', seven_day: 'WEEKLY', seven_day_opus: 'OPUS', seven_day_sonnet: 'SONNET', seven_day_fable: 'FABLE' };
  const L = { en: { left: 'left', ago: n => `${n} min ago` }, ja: { left: '残', ago: n => `${n}分前` } };
  Orbit.widget({
    mount(ctx) { ctx.root.innerHTML = '<div class="cu"></div>'; },
    on: {
      claudeUsage(d, ctx) {
        if (!d || !Array.isArray(d.rows)) return;
        const s = ctx.settings, l = L[ctx.lang] || L.en, esc = ctx.esc;
        const ago = Math.max(0, Math.round((Date.now() / 1000 - d.fetched) / 60));
        ctx.root.firstChild.innerHTML = d.rows.map(r => {
          const left = Math.max(0, Math.min(100, Math.round(100 - r.pct)));
          const rs = r.resets ? new Date(r.resets).toLocaleString(ctx.locale, { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: ctx.hour12 }) : '';
          const color = left < s.critical_below ? '#ff5a6e' : left < s.warn_below ? '#ffb84d' : `rgb(${ctx.rgb('c')})`;
          const pctTxt = ctx.lang === 'ja' ? `${l.left} ${left}%` : `${left}% ${l.left}`;
          return `<div class="row"><span class="k">CLAUDE ${esc(NAMES[r.key] || r.key)}</span><div class="meter"><i style="width:${left}%;background:${color}"></i></div><span class="v">${esc(pctTxt)}</span></div>
            <div class="row sub"><span></span><span class="k">reset ${esc(rs)}</span><span class="v"><small>${esc(l.ago(ago))}</small></span></div>`;
        }).join('');
      },
    },
  });
})();
