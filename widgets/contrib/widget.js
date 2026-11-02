/* CONTRIBUTIONS: GitHub contribution heatmap for the last 13 weeks (Sunday-first), with totals and streak.
   Ported from the prototype wallpaper's "contrib" module. */
(() => {
  'use strict';
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const U = Orbit.ui, c = C.signals.contrib;
    if (!c || !Array.isArray(c.days)) { if (lastKey !== 'wait') { lastKey = 'wait'; m.body.innerHTML = '<div class="foot">取得中…</div>'; } return; }
    const today = U.day0(), key = U.ymd(today) + '|' + JSON.stringify(c.days.slice(-100)) + c.year + C.theme.palette?.c;
    if (key === lastKey) return; lastKey = key;
    const weeks = Math.max(1, C.settings.weeks | 0);
    const map = new Map(c.days), start = new Date(today); start.setDate(today.getDate() - today.getDay() - 7 * (weeks - 1));   // full weeks + this week
    const vals = [], cells = [];
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) vals.push([U.ymd(d), +map.get(U.ymd(d)) || 0]);
    const max = Math.max(1, ...vals.map(v => v[1])), col = C.rgb('c');
    for (const [k, v] of vals) { const a = v ? .22 + .73 * Math.sqrt(v / max) : 0;
      cells.push(`<i class="${k === U.ymd(today) ? 'today' : ''}" style="${v ? `background:rgba(${col},${a.toFixed(2)})` : ''}"></i>`); }
    const total = vals.reduce((a, v) => a + v[1], 0); let streak = 0;
    for (let i = vals.length - 1; i >= 0 && (vals[i][1] || i === vals.length - 1); i--) if (vals[i][1]) streak++;
    m.body.innerHTML = `<div class="heatwrap"><div class="wd">${['日', '', '火', '', '木', '', '土'].map(x => `<span>${x}</span>`).join('')}</div><div class="heat">${cells.join('')}</div></div>
      <div class="foot" style="margin-top:calc(var(--vh) * 1.6)">${weeks}週 ${total}${c.year != null ? ` · 今年 ${U.esc(c.year)}` : ''}${streak ? ` · 連続 ${streak}日` : ''}</div>`;
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'CONTRIBUTIONS', 'm-contrib'); m.meta.textContent = 'GITHUB'; render(); },
    on: { contrib() { render(); }, time() { render(); } },
    theme() { lastKey = ''; render(); },
  });
})();
