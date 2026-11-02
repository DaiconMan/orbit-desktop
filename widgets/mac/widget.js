/* MAC: battery, free disk, Time Machine, active time today (ported from the prototype's MAC module). */
(() => {
  const { tile, meter, agoTxt } = Orbit.ui;
  let mod = null;
  Orbit.widget({
    mount(ctx) { mod = Orbit.module(ctx, 'MAC', 'm-mac'); },
    on: {
      mac(m, ctx) {
        m = m || {};
        const c = `rgb(${ctx.rgb('c')})`, t = [];
        if (m.batt != null) t.push(tile(`${m.batt}<small>%</small>`, m.ac ? (m.batt_state === 'charged' ? 'BATTERY · 充電済み' : 'BATTERY · 充電中') : (m.batt_left ? `BATTERY · 残り ${Orbit.ui.esc(m.batt_left)}` : 'BATTERY'),
          !m.ac && m.batt < 20 ? 'warn' : '', meter(m.batt, c)));
        if (m.disk_free) t.push(tile(`${(m.disk_free / 2 ** 30).toFixed(0)}<small>GB</small>`, 'DISK 空き', m.disk_free / m.disk_total < .1 ? 'warn' : '', meter(100 - m.disk_free / m.disk_total * 100)));
        if (m.tm_running) t.push(tile(`${m.tm_pct != null ? Math.round(m.tm_pct) + '<small>%</small>' : '…'}`, 'BACKUP · 実行中', '', meter(m.tm_pct || 0, c)));
        else if (m.tm_last) t.push(tile(agoTxt(m.tm_last), 'TIME MACHINE', Date.now() / 1000 - m.tm_last > 3 * 86400 ? 'warn' : ''));
        const mn = (m.active || {}).minutes || 0;
        t.push(tile(mn >= 60 ? `${Math.floor(mn / 60)}<small>h</small> ${mn % 60}<small>m</small>` : `${mn}<small>m</small>`, 'ACTIVE TODAY'));
        mod.body.innerHTML = `<div class="tiles">${t.join('')}</div>`;
      },
    },
  });
})();
