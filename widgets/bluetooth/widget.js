/* BLUETOOTH: connected devices with battery (prototype's BLUETOOTH module); hidden if none. */
(() => {
  const { esc, meter } = Orbit.ui;
  let mod = null, key = '';
  Orbit.widget({
    mount(ctx) { mod = Orbit.module(ctx, 'BLUETOOTH', 'm-bluetooth'); ctx.visible(false); },
    on: {
      bluetooth(b, ctx) {
        if (!b || !b.devices || !b.devices.length) { key = ''; return ctx.visible(false); }
        const k = JSON.stringify(b.devices); if (k === key) return; key = k;
        const c = `rgb(${ctx.rgb('c')})`;
        mod.body.innerHTML = `<div class="bt">${b.devices.slice(0, 4).map(d => {
          const bt = d.battery || {}, vals = ['main', 'L', 'R'].map(x => bt[x]).filter(x => x != null), lo = vals.length ? Math.min(...vals) : null;
          const sub = (bt.L != null || bt.R != null || bt.case != null) ? [['L', bt.L], ['R', bt.R], ['ケース', bt.case]].filter(x => x[1] != null).map(([x, y]) => `${x} ${+y}%`).join(' · ') : '';
          return `<div class="row"><span class="k">${esc(d.name)}</span>${lo != null ? meter(lo, lo <= 20 ? '#ffb37a' : c) : '<span></span>'}<span class="v ${lo != null && lo <= 20 ? 'warn' : ''}">${lo != null ? +lo + '%' : '接続'}</span></div>${sub ? `<div class="row" style="height:auto"><span class="sub">${sub}</span></div>` : ''}`; }).join('')}</div>`;
        mod.meta.textContent = `${b.devices.length} CONNECTED`;
        ctx.visible(true);
      },
    },
    theme() { key = ''; },
  });
})();
