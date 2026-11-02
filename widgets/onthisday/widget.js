/* ON THIS DAY: today's observances plus three historical events (one each from the early / middle /
   recent part of the list, picked with a date-seeded random so it stays stable all day).
   Ported from the prototype wallpaper's "onthisday" module. Hidden unless the data is for today. */
(() => {
  'use strict';
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const U = Orbit.ui, esc = U.esc, o = C.signals.onthisday, set = C.settings;
    if (!o || o.date !== U.ymd(new Date()) || !Array.isArray(o.events)) { lastKey = ''; C.visible(false); return; }
    const key = o.date + o.events.length + (o.observances || []).length; if (key === lastKey) return; lastKey = key;
    let seed = +o.date.replace(/-/g, ''); const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pool = o.events.filter(e => e && e.text && e.text.length <= set.max_chars && e.year >= set.min_year), pick = [];
    for (const third of [0, 1, 2]) {   // one each from early / middle / recent thirds, so the years spread out
      const part = pool.slice(Math.floor(pool.length * third / 3), Math.floor(pool.length * (third + 1) / 3)); if (part.length) pick.push(part[Math.floor(rnd() * part.length)]);
    }
    const obs = (o.observances || []).slice(0, 3);
    m.body.innerHTML = `<div class="otd">${obs.length ? `<div class="obs">${obs.map(esc).join('・')}</div>` : ''}${pick.map(e => `<div class="ev"><span class="y">${esc(e.year)}</span><span class="x">${esc(e.text.replace(/。$/, ''))}</span></div>`).join('')}</div>`;
    m.meta.textContent = `${+o.date.slice(5, 7)}/${+o.date.slice(8)}`;
    C.visible(true);
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'ON THIS DAY', 'm-onthisday'); render(); },
    on: { onthisday() { render(); }, time() { render(); } },
  });
})();
