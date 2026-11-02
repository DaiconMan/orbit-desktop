/* RAIN 2H: Open-Meteo minutely_15 precipitation (8 × 15 min); hidden while it stays dry (prototype's RAIN 2H module). */
(() => {
  let mod = null, key = '';
  Orbit.widget({
    mount(ctx) { mod = Orbit.module(ctx, 'RAIN 2H', 'm-rain'); mod.meta.textContent = '15 MIN'; ctx.visible(false); },
    on: {
      weather(w, ctx) {
        const m = w && w.minutely_15; if (!m || !m.precipitation || !m.time) return ctx.visible(false);
        const pr = m.precipitation.slice(0, 8).map(v => +v || 0), k = pr.join() + m.time[0]; if (k === key) return; key = k;
        if (!pr.some(v => v >= 0.05)) return ctx.visible(false);
        const mx = Math.max(1, ...pr), first = pr.findIndex(v => v >= 0.05), sum = pr.reduce((a, b) => a + b, 0) / 4;
        mod.body.innerHTML = `<div class="big"><b>${sum.toFixed(1)}</b><small>MM / 2H</small></div><div class="hintl warn">${first === 0 ? 'いま降っています' : first * 15 + '分後から雨'}</div>
          <div class="vbars">${pr.map(v => `<i class="${v >= .05 ? 'rn' : ''}" style="height:${Math.max(2, Math.sqrt(v / mx) * 100)}%"></i>`).join('')}</div>
          <div class="axis"><span>${Orbit.ui.esc(String(m.time[0]).slice(11, 16))}</span><span>+1h</span><span>+2h</span></div>`;
        ctx.visible(true);
      },
    },
  });
})();
