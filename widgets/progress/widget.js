/* PROGRESS: how far through the day / week / month / year we are.
   Ported from the prototype wallpaper's "progress" module. Weeks start on Monday. */
(() => {
  'use strict';
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const U = Orbit.ui, n = new Date(), key = Math.floor(n / 60000); if (key === lastKey) return; lastKey = key;
    const d0 = U.day0(), wk0 = new Date(d0); wk0.setDate(d0.getDate() - (d0.getDay() + (C.settings.week_starts_monday ? 6 : 0)) % 7);
    const mo0 = new Date(n.getFullYear(), n.getMonth(), 1), mo1 = new Date(n.getFullYear(), n.getMonth() + 1, 1);
    const y0 = new Date(n.getFullYear(), 0, 1), y1 = new Date(n.getFullYear() + 1, 0, 1);
    const all = { day: ['DAY', (n - d0) / 864e5], week: ['WEEK', (n - wk0) / (7 * 864e5)], month: ['MONTH', (n - mo0) / (mo1 - mo0)], year: ['YEAR', (n - y0) / (y1 - y0)] };
    const rows = (C.settings.bars || []).map(b => all[String(b).toLowerCase()]).filter(Boolean);
    m.body.innerHTML = rows.map(([k, f]) => `<div class="pg"><span class="k">${k}</span>${U.meter(f * 100)}<span class="v">${(f * 100).toFixed(f < .1 ? 1 : 0)}%</span></div>`).join('');
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'PROGRESS', 'm-progress'); render(); },
    on: { time() { render(); } },
  });
})();
