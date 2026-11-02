/* WORLD: world clock tiles (time, offset from local time, 昨日 / 明日 marks).
   Ported from the prototype wallpaper's "world" module. */
(() => {
  'use strict';
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const ctx = C, U = Orbit.ui, esc = U.esc, now = new Date();
    const key = Math.floor(now / 60000) + '|' + ctx.locale; if (key === lastKey) return; lastKey = key;
    const homeTz = ctx.settings.home_tz || (ctx.signals.time && ctx.signals.time.tz) || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const at = tz => { try { return new Date(now.toLocaleString('en-US', { timeZone: tz })); } catch (_) { return null; } };
    const here = at(homeTz) || now;
    const tiles = (ctx.settings.clocks || []).map(c => {
      const z = c && (c.tz || c.timezone), d = z && at(z); if (!d) return '';
      const t = now.toLocaleTimeString(ctx.locale, { timeZone: z, hour: '2-digit', minute: '2-digit', hour12: ctx.hour12 });
      const off = Math.round((d - here) / 3600e3);
      const dd = d.getDate() !== here.getDate() ? `<small>${d < here ? '昨日' : '明日'}</small>` : '';
      return U.tile(esc(t) + dd, `${esc(c.label || z)}${off ? ` ${off > 0 ? '+' : '−'}${Math.abs(off)}` : ''}`);
    }).join('');
    m.body.innerHTML = `<div class="tiles wc">${tiles}</div>`;
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'WORLD', 'm-world'); render(); },
    on: { time() { render(); } },
    theme() { lastKey = ''; render(); },
  });
})();
