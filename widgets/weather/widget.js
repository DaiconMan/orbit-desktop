/* Weather: current, hourly, daily, rain soon / umbrella, UV, PM2.5 / AQI (ported from the prototype's WEATHER module).
   Data is the host's Open-Meteo forecast (+ `air`); the header meta shows the place name. */
(() => {
  const U = Orbit.ui;
  let m = null;
  Orbit.widget({
    mount(ctx) { m = Orbit.module(ctx, 'WEATHER', 'wx'); ctx.visible(false); },
    on: {
      weather(w, ctx) {
        if (!w || !w.current || !w.hourly || !w.daily) return ctx.visible(false);
        const s = ctx.settings, e = U.esc, r = Math.round, air = w.air, now = new Date();
        m.meta.textContent = w.place || '';
        const [ic, txt] = U.WMO(w.current.weather_code), night = !w.current.is_day && w.current.weather_code <= 2;
        const hp = w.hourly.precipitation_probability || [];
        const hrs = w.hourly.time.map((t, i) => i % s.hour_step === 0
          ? `<div class="cell"><small>${e(t.slice(11, 13))}時</small><b>${U.WMO(w.hourly.weather_code[i])[0]}</b>${r(w.hourly.temperature_2m[i])}°<br><small class="rain">${hp[i] ?? 0}%</small></div>` : '').join('');
        const dp = w.daily.precipitation_probability_max || [];
        const days = w.daily.time.slice(1, 1 + s.days).map((t, i) => { i++;
          return `<div class="cell"><small>${U.WD[new Date(t + 'T12:00:00').getDay()]}</small><b>${U.WMO(w.daily.weather_code[i])[0]}</b>${r(w.daily.temperature_2m_max[i])}/${r(w.daily.temperature_2m_min[i])}<br><small class="rain">${dp[i] ?? 0}%</small></div>`; }).join('');
        const aux = [], uv = w.daily.uv_index_max && w.daily.uv_index_max[0];
        if (w.minutely_15 && w.minutely_15.precipitation) {          // rain within the hour
          const pr = w.minutely_15.precipitation.slice(0, 4), i = pr.findIndex(x => x > 0.05);
          if (i >= 0) aux.push(`<span class="warn">${i === 0 ? 'いま' : i * 15 + '分後'}から雨</span>`);
        }
        if (hp.length) {                                             // umbrella: max probability for the rest of today's daytime
          let best = null; const today = U.ymd(now);
          w.hourly.time.forEach((t, i) => { const h = +t.slice(11, 13), p = hp[i];
            if (t.slice(0, 10) === today && h >= now.getHours() && h <= 20 && p != null && (!best || p > best.p)) best = { h, p }; });
          if (best && best.p >= 50) aux.push(`<span class="${best.p >= 80 ? 'warn' : ''}">傘 ${best.h}時 ${best.p}%</span>`);
        }
        if (uv != null) aux.push(`<span class="${uv >= 6 ? 'warn' : ''}">UV ${r(uv)}</span>`);
        if (air && air.pm25 != null) aux.push(`PM2.5 ${r(air.pm25)}`);
        if (air && air.aqi != null) aux.push(`<span class="${air.aqi >= 100 ? 'warn' : ''}">AQI ${r(air.aqi)}</span>`);
        const groups = [aux.filter(a => /雨|傘/.test(a)), aux.filter(a => !/雨|傘/.test(a))].filter(g => g.length);
        m.body.innerHTML = `<div class="now"><span class="ic">${night ? '🌙' : ic}</span><span class="t">${r(w.current.temperature_2m)}°</span>
          <span class="d">${txt}　${r(w.daily.temperature_2m_max[0])}° / ${r(w.daily.temperature_2m_min[0])}°</span></div>
          ${s.show_aux && groups.length ? `<div class="aux">${groups.map(g => `<div>${g.join(' · ')}</div>`).join('')}</div>` : ''}
          <div class="hours">${hrs}</div>${s.days ? `<div class="days">${days}</div>` : ''}
          ${s.show_attribution ? '<div class="attr">Weather data by Open-Meteo.com</div>' : ''}`;
        ctx.visible(true);
      },
    },
  });
})();
