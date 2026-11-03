/* POWER: what the USB-C charger offers, what was negotiated, and what really flows in (from the battery
   controller via the host). Warning signs (port fault counters moving, input voltage off the contract, power
   above the rating) turn the module's header red. Software can only watch: it cannot stop a surge. */
(() => {
  'use strict';
  const { esc, spark, kv } = Orbit.ui;
  let m = null;
  const f1 = n => (n == null ? '—' : (+n).toFixed(n >= 10 ? 1 : 2));
  Orbit.widget({
    mount(ctx) { m = Orbit.module(ctx, 'POWER', 'm-power'); },
    on: {
      power(p, ctx) {
        if (!p) return;
        const s = ctx.settings, ad = p.adapter, inp = p.input, c = `rgb(${ctx.rgb('c')})`;
        const alerts = p.alerts || [], bad = alerts.some(a => a.level === 'danger'), warn = alerts.some(a => a.level === 'warn');
        m.el.classList.toggle('bad', bad); m.el.classList.toggle('warnish', !bad && warn);
        m.meta.innerHTML = !p.connected ? 'バッテリー駆動' : bad ? '<span class="warn">要確認</span>' : p.charging ? '<span class="ok">●</span> 充電中' : p.full ? '充電済み' : '接続';
        if (!p.connected || !ad) {
          m.body.innerHTML = kv('BATTERY', `${p.percent != null ? p.percent + '%' : '—'}<small>${f1(p.battery && p.battery.watts)}W 放電</small>`);
          return;
        }
        const big = `<div class="big"><b>${f1(inp && inp.watts)}</b><small>W 入力</small><span class="va">${f1(inp && inp.volts)}V · ${f1(inp && inp.amps)}A</span></div>`;
        const contract = `${esc(ad.name || ad.description)}<small>${ad.volts ? ad.volts.toFixed(0) + 'V ' + f1(ad.amps) + 'A' : ''}${ad.watts ? ' · 最大 ' + ad.watts + 'W' : ''}</small>`;
        const offers = s.show_offers && ad.offers && ad.offers.length
          ? `<div class="pdo">${ad.offers.map((o, i) => `<span class="${i === ad.active ? 'on' : ''}">${o.v.toFixed(0)}V<small>${o.a.toFixed(1)}A</small></span>`).join('')}</div>` : '';
        const rows = [kv('ADAPTER', contract)];
        if (s.show_battery && p.battery) rows.push(kv('BATTERY', `${p.percent != null ? p.percent + '%' : ''}<small>${p.battery.watts >= 0 ? f1(p.battery.watts) + 'W 充電' : f1(-p.battery.watts) + 'W 放電'} · ${f1(p.battery.volts)}V</small>`));
        if (inp && inp.loss_watts) rows.push(kv('LOSS', `${f1(inp.loss_watts)}W<small>アダプタ側の損失</small>`));
        const al = alerts.length ? `<div class="al">${alerts.slice(0, 3).map(a => `<div class="${a.level}">${esc(a.text)}</div>`).join('')}</div>` : '';
        m.body.innerHTML = `${big}<canvas id="pw-spark" class="sp"></canvas>${offers}${rows.join('')}${al}`;
        const h = p.history || [];
        for (const v of h.slice(-60)) spark('pw-spark', v, ad.watts || Math.max(...h, 1), bad ? '#ff6b7a' : c);
      },
    },
  });
})();
