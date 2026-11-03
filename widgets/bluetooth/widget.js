/* BLUETOOTH: connected devices with battery (prototype's BLUETOOTH module). Devices that are paired but not
   connected are listed dimmed as 未接続, so the module explains itself instead of vanishing. */
(() => {
  const { esc, meter } = Orbit.ui;
  let mod = null, key = '';
  Orbit.widget({
    mount(ctx) { mod = Orbit.module(ctx, 'BLUETOOTH', 'm-bluetooth'); ctx.visible(false); },
    on: {
      bluetooth(b, ctx) {
        const devs = (b && b.devices) || [], paired = ctx.settings.show_paired ? ((b && b.paired) || []) : [];
        if (!devs.length && !paired.length) { key = ''; return ctx.visible(false); }
        const k = JSON.stringify([devs, paired]); if (k === key) return; key = k;
        const c = `rgb(${ctx.rgb('c')})`;
        const on = devs.slice(0, 4).map(d => {
          const bt = d.battery || {}, vals = ['main', 'L', 'R'].map(x => bt[x]).filter(x => x != null), lo = vals.length ? Math.min(...vals) : null;
          const sub = (bt.L != null || bt.R != null || bt.case != null) ? [['L', bt.L], ['R', bt.R], ['ケース', bt.case]].filter(x => x[1] != null).map(([x, y]) => `${x} ${+y}%`).join(' · ') : '';
          return `<div class="row"><span class="k">${esc(d.name)}</span>${lo != null ? meter(lo, lo <= 20 ? '#ffb37a' : c) : '<span></span>'}<span class="v ${lo != null && lo <= 20 ? 'warn' : ''}">${lo != null ? +lo + '%' : '接続中'}</span></div>${sub ? `<div class="row" style="height:auto"><span class="sub">${sub}</span></div>` : ''}`;
        });
        const off = paired.slice(0, Math.max(0, 3 - on.length)).map(d => `<div class="row off"><span class="k">${esc(d.name)}</span><span></span><span class="v">未接続</span></div>`);
        mod.body.innerHTML = `<div class="bt">${on.join('')}${off.join('')}</div>`;
        mod.meta.textContent = devs.length ? `${devs.length} 台接続中` : '接続中の機器なし';
        ctx.visible(true);
      },
    },
    theme() { key = ''; },
  });
})();
