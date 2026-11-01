/* Weather: WMO weather codes -> emoji + localized text. Data comes from the host's
   Open-Meteo provider; the place name is the configured / detected location name. */
(() => {
  const T = {
    en: ['Clear', 'Fair', 'Cloudy', 'Fog', 'Drizzle', 'Rain', 'Snow', 'Showers', 'Snow showers', 'Thunderstorm'],
    ja: ['快晴', '晴れ', 'くもり', '霧', '霧雨', '雨', '雪', 'にわか雨', 'にわか雪', '雷雨'],
  };
  const IC = ['☀️', '🌤️', '☁️', '☁️', '🌦️', '🌧️', '🌨️', '🌧️', '🌨️', '⛈️'];
  const idx = c => c === 0 ? 0 : c <= 2 ? 1 : c === 3 ? 2 : c <= 48 ? 3 : c <= 57 ? 4 : c <= 67 ? 5 : c <= 77 ? 6 : c <= 82 ? 7 : c <= 86 ? 8 : 9;
  Orbit.widget({
    mount(ctx) { ctx.root.innerHTML = '<div class="wx"></div>'; },
    on: {
      weather(w, ctx) {
        if (!w || !w.current || !w.hourly || !w.daily) return;
        const s = ctx.settings, e = ctx.esc, txt = T[ctx.lang] || T.en, r = Math.round;
        const i0 = idx(w.current.weather_code), night = !w.current.is_day && w.current.weather_code <= 2;
        const hourFmt = new Intl.DateTimeFormat(ctx.locale, { hour: 'numeric', hour12: ctx.hour12 });
        const dayFmt = new Intl.DateTimeFormat(ctx.locale, { weekday: 'short' });
        const rain = p => s.show_rain ? `<br><small class="rain">${r(+p || 0)}%</small>` : '';
        const hrs = w.hourly.time.map((t, i) => i % s.hour_step === 0
          ? `<div class="cell"><small>${e(hourFmt.format(new Date(t)))}</small><b>${IC[idx(w.hourly.weather_code[i])]}</b>${r(w.hourly.temperature_2m[i])}°${rain(w.hourly.precipitation_probability[i])}</div>` : '').join('');
        const days = w.daily.time.slice(1, 1 + s.days).map((t, i) => { i++;
          return `<div class="cell"><small>${e(dayFmt.format(new Date(t + 'T12:00:00')))}</small><b>${IC[idx(w.daily.weather_code[i])]}</b>${r(w.daily.temperature_2m_max[i])}/${r(w.daily.temperature_2m_min[i])}${rain(w.daily.precipitation_probability_max[i])}</div>`; }).join('');
        ctx.root.firstChild.innerHTML = `${s.show_place ? `<div class="place">${e(w.place || '')}</div>` : ''}
          <div class="now"><span class="ic">${night ? '🌙' : IC[i0]}</span><span class="t">${r(w.current.temperature_2m)}°</span>
          <span class="d">${e(txt[i0])}　${r(w.daily.temperature_2m_max[0])}° / ${r(w.daily.temperature_2m_min[0])}°</span></div>
          <div class="hours">${hrs}</div>${s.days ? `<div class="days">${days}</div>` : ''}
          ${s.show_attribution ? '<div class="attr">Weather data by Open-Meteo.com</div>' : ''}`;
      },
    },
  });
})();
