/* LIFE: next holiday, FX, latest notable quake, EEW link state (ported from the prototype's LIFE module). */
(() => {
  const { kv, esc, day0, WD, SCALE, dayWord } = Orbit.ui;
  let m = null;
  function render(ctx) {
    const S = ctx.signals;
    let h = '';
    const hol = ((S.holidays || {}).upcoming || []).map(x => ({ ...x, t: new Date(x.date + 'T00:00:00') })).find(x => x.t >= day0());
    if (hol) { const dd = Math.round((hol.t - day0()) / 864e5); h += kv('HOLIDAY', `${esc(hol.name)}<small>${hol.t.getMonth() + 1}/${hol.t.getDate()}(${WD[hol.t.getDay()]}) ${dayWord(dd)}</small>`); }
    const fx = S.fx;
    if (fx && fx.rate) { const dv = fx.prev ? fx.rate - fx.prev : 0;
      h += kv('USD/JPY', `${fx.rate.toFixed(2)}${dv ? `<small>${dv > 0 ? '▲' : '▼'} ${Math.abs(dv).toFixed(2)}</small>` : ''}`); }
    const qs = Array.isArray(S.quakes) ? S.quakes : null;
    if (qs && qs.length) { const q = qs[0], tm = new Date(q.ts * 1000).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      h += kv('QUAKE', `${tm} ${esc(q.place || '調査中')} 震度${SCALE[q.scale] || '?'}<small>${q.mag ? 'M' + q.mag.toFixed(1) : ''}${qs.length > 1 ? ' +' + (qs.length - 1) : ''}</small>`, q.scale >= 45 ? 'warn' : '');
    } else h += kv('QUAKE', '<span style="opacity:.55">24時間 震度3以上なし</span>');
    m.body.innerHTML = h;
    const a = S.alerts || {}, ws = a.ws, en = a.eewEnabled !== false;
    m.meta.innerHTML = !en ? 'EEW OFF' : ws && ws.connected ? '<span class="ok">●</span> EEW LIVE' : 'EEW ○ 再接続中';
  }
  Orbit.widget({
    mount(ctx) { m = Orbit.module(ctx, 'LIFE', 'm-life'); render(ctx); },
    on: { holidays: (d, c) => render(c), fx: (d, c) => render(c), quakes: (d, c) => render(c), alerts: (d, c) => render(c) },
  });
})();
