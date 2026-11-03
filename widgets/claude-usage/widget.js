/* UNOFFICIAL Claude usage meters in the shared module look (like LOAD): remaining % per window and when it resets.
   Data: host provider claude_usage (opt-in), which forwards only {key, pct, resets}. */
(() => {
  'use strict';
  const NAMES = { five_hour: '5H', seven_day: 'WEEKLY', seven_day_opus: 'OPUS', seven_day_sonnet: 'SONNET', seven_day_fable: 'FABLE' };
  let m = null;
  Orbit.widget({
    mount(ctx) { m = Orbit.module(ctx, 'CLAUDE', 'm-cu'); ctx.visible(false); },
    on: {
      claudeUsage(d, ctx) {
        if (!d || !Array.isArray(d.rows) || !d.rows.length) return ctx.visible(false);
        const s = ctx.settings, esc = ctx.esc, ja = ctx.lang === 'ja';
        const ago = Math.max(0, Math.round((Date.now() / 1000 - d.fetched) / 60));
        m.meta.textContent = ago < 1 ? (ja ? 'たった今' : 'just now') : ago < 60 ? (ja ? `${ago}分前` : `${ago} min ago`) : (ja ? `${Math.round(ago / 60)}時間前` : `${Math.round(ago / 60)} h ago`);
        // the numbers are Claude Code's own cached copy: say clearly when it is old or already past its reset
        const stale = ago >= 180;
        m.el.classList.toggle('stale', stale);
        if (stale) m.meta.textContent = ja ? `${ago >= 2880 ? Math.round(ago / 1440) + '日' : Math.round(ago / 60) + '時間'}前のデータ` : `data from ${Math.round(ago / 60)} h ago`;
        m.body.innerHTML = d.rows.map(r => {
          if (r.resets && new Date(r.resets).getTime() < Date.now())
            return `<div class="row"><span class="k">${esc(NAMES[r.key] || r.key)}</span><span></span><span class="v">${ja ? 'リセット済み' : 'reset'}</span></div>`;
          const left = Math.max(0, Math.min(100, Math.round(100 - r.pct)));
          const rs = r.resets ? new Date(r.resets).toLocaleString(ctx.locale, { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: ctx.hour12 }) : '';
          const warn = left < s.critical_below ? 'bad' : left < s.warn_below ? 'warn' : '';
          const color = warn === 'bad' ? '#ff6b7a' : warn ? '#ffb37a' : `rgb(${ctx.rgb('c')})`;
          return `<div class="row"><span class="k">${esc(NAMES[r.key] || r.key)}</span>${Orbit.ui.meter(left, color)}<span class="v ${warn ? 'warn' : ''}">${ja ? '残 ' : ''}${left}%${ja ? '' : ' left'}</span></div>` +
            (rs ? `<div class="sub">${ja ? 'リセット' : 'resets'} ${esc(rs)}</div>` : '');
        }).join('');
        ctx.visible(true);
      },
    },
  });
})();
