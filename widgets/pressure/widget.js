/* PRESSURE: surface pressure past 12 h -> next 24 h; 頭痛注意 on drops >= 4 hPa / 6 h (prototype's PRESSURE module).
   Data: weather.pressure = {time: [...hourly ISO], hpa: [...], at}. */
(() => {
  const { ymd } = Orbit.ui;
  let mod = null, key = '';
  Orbit.widget({
    mount(ctx) { mod = Orbit.module(ctx, 'PRESSURE', 'm-pressure'); ctx.visible(false); },
    on: {
      weather(w, ctx) {
        const p = w && w.pressure; if (!p || !p.hpa || !p.time || p.hpa.length < 8) return ctx.visible(false);
        const n = new Date(), hk = `${ymd(n)}T${String(n.getHours()).padStart(2, '0')}:00`, k = p.at + hk; if (k === key) return; key = k;
        const v = p.hpa.map(Number), i0 = Math.max(0, p.time.indexOf(hk)), now = v[i0];
        let drop = 0, dropAt = null;   // steepest 6 h fall touching now or the future
        for (let i = Math.max(0, i0 - 6); i + 6 < v.length; i++) { const d = v[i] - v[i + 6]; if (d > drop) { drop = d; dropAt = i + 6; } }
        const lo = Math.min(...v) - .5, hi = Math.max(...v) + .5, W = 100, Hh = 30, X = i => i / (v.length - 1) * W, Y = x => Hh - (x - lo) / (hi - lo) * Hh;
        const pts = v.map((x, i) => `${X(i).toFixed(1)},${Y(x).toFixed(1)}`);
        const d6 = v[Math.min(v.length - 1, i0 + 6)] - now, warn = drop >= ctx.settings.drop_hpa;
        const when = dropAt != null ? String(p.time[dropAt]).slice(11, 13) + '時頃' : '';
        mod.body.innerHTML = `<div class="big"><b>${Math.round(now)}</b><small>HPA · 6H ${d6 >= 0 ? '+' : '−'}${Math.abs(d6).toFixed(1)}</small></div>${warn ? `<div class="hintl warn">頭痛注意 · ${Orbit.ui.esc(when)}に気圧低下</div>` : ''}
          <svg class="psvg" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">
            <polyline points="${pts.slice(0, i0 + 1).join(' ')}" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
            <polyline points="${pts.slice(i0).join(' ')}" fill="none" stroke="rgb(${ctx.rgb('c')})" stroke-opacity=".85" stroke-width="1.4" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/>
            <line x1="${X(i0)}" x2="${X(i0)}" y1="0" y2="${Hh}" stroke="rgba(255,255,255,.25)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>
          <div class="axis"><span>−${i0}h</span><span>NOW</span><span>+${v.length - 1 - i0}h</span></div>`;
        mod.meta.textContent = `${Math.round(Math.min(...v))}–${Math.round(Math.max(...v))}`;
        ctx.visible(true);
      },
    },
    theme() { key = ''; },
  });
})();
