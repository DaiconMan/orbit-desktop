/* SPACE WEATHER: NOAA planetary Kp index, 3-hourly bars for the last 3 days.
   Ported from the prototype wallpaper's "kp" module. Hidden while there is no data. */
(() => {
  'use strict';
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const k = C.signals.kp;
    if (!k || !Array.isArray(k.rows) || !k.rows.length) { lastKey = ''; C.visible(false); return; }
    const key = k.at + '|' + JSON.stringify(k.rows[k.rows.length - 1]) + k.rows.length; if (key === lastKey) return; lastKey = key;
    const rows = k.rows.slice(-24).map(r => [r[0], +r[1] || 0]), cur = rows[rows.length - 1][1], mx = Math.max(...rows.map(r => r[1]));
    const lab = c => c >= 7 ? '強い磁気嵐' : c >= 5 ? '磁気嵐' : c >= 4 ? 'やや活発' : '静穏';
    const hint = !C.settings.aurora_hint ? '' : cur >= 7 ? '北海道でもオーロラの可能性' : cur >= 5 ? '高緯度でオーロラ チャンス' : '';
    const t0 = new Date(String(rows[0][0]) + 'Z');
    m.body.innerHTML = `<div class="big"><b>${cur.toFixed(1)}</b><small>KP · ${lab(cur)}</small></div>${hint ? `<div class="hintl warn">${hint}</div>` : ''}
      <div class="vbars">${rows.map((r, i) => `<i class="${r[1] >= 5 ? 'k5' : r[1] >= 4 ? 'k4' : ''}${i === rows.length - 1 ? ' last' : ''}" style="height:${Math.max(3, r[1] / 9 * 100)}%"></i>`).join('')}</div>
      <div class="axis"><span>${isNaN(t0) ? '' : `${t0.getMonth() + 1}/${t0.getDate()}`}</span><span>3日間 最大 ${mx.toFixed(1)}</span><span>NOW</span></div>`;
    C.visible(true);
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'SPACE WEATHER', 'm-kp'); m.meta.textContent = 'NOAA'; render(); },
    on: { kp() { render(); } },
  });
})();
