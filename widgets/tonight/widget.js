/* TONIGHT: moon phase, planets above the horizon, ISS, next meteor shower, sunrise / sunset.
   Ported from the prototype wallpaper's "tonight" module. Positions are computed locally from the
   observer's location (Schlyter's orbital elements); the ISS position comes from the iss signal. */
(() => {
  'use strict';
  /* ---------- astronomy (from the starfield: Schlyter's simplified orbital elements, ~1° accuracy) ---------- */
  let loc = { lat: 35.48, lon: 139.63 };
  const rad = Math.PI / 180, D2R = rad, R2D = 180 / Math.PI, n360 = x => ((x % 360) + 360) % 360;
  function lst(date, lonDeg) {  // local sidereal time in degrees
    const jd = date.getTime() / 86400000 + 2440587.5;
    return ((280.46061837 + 360.98564736629 * (jd - 2451545) + lonDeg) % 360 + 360) % 360;
  }
  function kepler(M, e) { let E = M + e * Math.sin(M) * (1 + e * Math.cos(M)); for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); return E; }
  function orb(N, i, w, a, e, M) {
    N *= D2R; i *= D2R; w *= D2R; M = n360(M) * D2R;
    const E = kepler(M, e), xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const v = Math.atan2(yv, xv), r = Math.hypot(xv, yv);
    return [r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i)),
            r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i)),
            r * Math.sin(v + w) * Math.sin(i)];
  }
  function eclToRaDec([x, y, z], ecl) {
    const ye = y * Math.cos(ecl) - z * Math.sin(ecl), ze = y * Math.sin(ecl) + z * Math.cos(ecl);
    return [n360(Math.atan2(ye, x) * R2D), Math.atan2(ze, Math.hypot(x, ye)) * R2D];
  }
  function solarSystem(date) {
    const d = date.getTime() / 86400000 + 2440587.5 - 2451543.5, ecl = (23.4393 - 3.563e-7 * d) * D2R;
    const ws = 282.9404 + 4.70935e-5 * d, es = .016709 - 1.151e-9 * d, Ms = 356.0470 + .9856002585 * d;
    const sun = orb(0, 0, ws, 1, es, Ms);                       // geocentric Sun
    const P = {
      '水星': [48.3313 + 3.24587e-5 * d, 7.0047 + 5e-8 * d, 29.1241 + 1.01444e-5 * d, .387098, .205635 + 5.59e-10 * d, 168.6562 + 4.0923344368 * d],
      '金星': [76.6799 + 2.4659e-5 * d, 3.3946 + 2.75e-8 * d, 54.891 + 1.38374e-5 * d, .72333, .006773 - 1.302e-9 * d, 48.0052 + 1.6021302244 * d],
      '火星': [49.5574 + 2.11081e-5 * d, 1.8497 - 1.78e-8 * d, 286.5016 + 2.92961e-5 * d, 1.523688, .093405 + 2.516e-9 * d, 18.6021 + .5240207766 * d],
      '木星': [100.4542 + 2.76854e-5 * d, 1.303 - 1.557e-7 * d, 273.8777 + 1.64505e-5 * d, 5.20256, .048498 + 4.469e-9 * d, 19.895 + .0830853001 * d],
      '土星': [113.6634 + 2.3898e-5 * d, 2.4886 - 1.081e-7 * d, 339.3939 + 2.97661e-5 * d, 9.55475, .055546 - 9.499e-9 * d, 316.967 + .0334442282 * d],
    };
    const out = [];
    for (const [name, [N, i, w, a, e, M]] of Object.entries(P)) {
      const h = orb(N, i, w, a, e, M);
      const [ra, dec] = eclToRaDec([h[0] + sun[0], h[1] + sun[1], h[2] + sun[2]], ecl);
      out.push({ name, ra, dec });
    }
    const moon = orb(125.1228 - .0529538083 * d, 5.1454, 318.0634 + .1643573223 * d, 60.2666, .0549, 115.3654 + 13.0649929509 * d);
    const [mra, mdec] = eclToRaDec(moon, ecl), [sra, sdec] = eclToRaDec(sun, ecl);
    const elong = Math.acos(Math.max(-1, Math.min(1, (moon[0] * sun[0] + moon[1] * sun[1] + moon[2] * sun[2]) / (Math.hypot(...moon) * Math.hypot(...sun)))));
    const dlon = n360(Math.atan2(moon[1], moon[0]) * R2D - Math.atan2(sun[1], sun[0]) * R2D);
    return { planets: out, moon: { ra: mra, dec: mdec, frac: (1 - Math.cos(elong)) / 2, waxing: dlon < 180, dlon }, sun: { ra: sra, dec: sdec } };
  }
  function altAz(raDeg, decDeg, L) {   // equatorial → horizontal (radians); zenith-centred, north up, east left
    const ha = (L - raDeg) * rad, dec = decDeg * rad, la = loc.lat * rad;
    const alt = Math.asin(Math.sin(dec) * Math.sin(la) + Math.cos(dec) * Math.cos(la) * Math.cos(ha));
    const az = Math.atan2(-Math.sin(ha) * Math.cos(dec), Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(ha));
    return { alt, az };
  }
  function issAltAz(i) {   // topocentric alt/az of the ISS from the observer (spherical Earth)
    const R = 6371, d2r = Math.PI / 180, la = loc.lat * d2r, lo = loc.lon * d2r, sl = i.lat * d2r, so = i.lon * d2r, rr = R + i.alt;
    const o = [R * Math.cos(la) * Math.cos(lo), R * Math.cos(la) * Math.sin(lo), R * Math.sin(la)];
    const q = [rr * Math.cos(sl) * Math.cos(so), rr * Math.cos(sl) * Math.sin(so), rr * Math.sin(sl)];
    const dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2];
    const e = -Math.sin(lo) * dx + Math.cos(lo) * dy;
    const n = -Math.sin(la) * Math.cos(lo) * dx - Math.sin(la) * Math.sin(lo) * dy + Math.cos(la) * dz;
    const u = Math.cos(la) * Math.cos(lo) * dx + Math.cos(la) * Math.sin(lo) * dy + Math.sin(la) * dz;
    return { alt: Math.atan2(u, Math.hypot(e, n)), az: Math.atan2(e, n), dist: Math.hypot(dx, dy, dz) };
  }
  // apparent brightness (rough typical magnitudes) and colours of naked-eye planets
  const PLANET_LOOK = { '水星': [-.2, '235,225,210'], '金星': [-4.2, '255,252,240'], '火星': [.4, '255,170,120'], '木星': [-2.3, '255,240,215'], '土星': [.6, '245,230,185'] };
  // observer: the location signal (falls back to the weather's coordinates)
  function setLoc(s) {
    const l = s.location, w = s.weather;
    if (l && l.lat != null && l.lon != null) loc = { lat: +l.lat, lon: +l.lon };
    else if (w && w.latitude != null) loc = { lat: +w.latitude, lon: +w.longitude };
  }

  /* annual meteor showers (IMO calendar; peak = month/day, active window, radiant J2000) */
  const SHOWERS = [
    { name: 'しぶんぎ座流星群', peak: [1, 4], from: [12, 28], to: [1, 12], zhr: 110, ra: 230, dec: 49 },
    { name: 'こと座流星群', peak: [4, 22], from: [4, 14], to: [4, 30], zhr: 18, ra: 271, dec: 34 },
    { name: 'みずがめ座η流星群', peak: [5, 6], from: [4, 19], to: [5, 28], zhr: 50, ra: 338, dec: -1 },
    { name: 'ペルセウス座流星群', peak: [8, 13], from: [7, 17], to: [8, 24], zhr: 100, ra: 48, dec: 58 },
    { name: 'オリオン座流星群', peak: [10, 21], from: [10, 2], to: [11, 7], zhr: 20, ra: 95, dec: 16 },
    { name: 'しし座流星群', peak: [11, 17], from: [11, 6], to: [11, 30], zhr: 15, ra: 152, dec: 22 },
    { name: 'ふたご座流星群', peak: [12, 14], from: [12, 4], to: [12, 17], zhr: 150, ra: 112, dec: 33 },
    { name: 'こぐま座流星群', peak: [12, 22], from: [12, 17], to: [12, 26], zhr: 10, ra: 217, dec: 76 },
  ];
  // nearest shower within ±3 days of its peak; night = peak night 20:00–05:00
  function showerNow(now) {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    for (const sh of SHOWERS) for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
      const pk = new Date(y, sh.peak[0] - 1, sh.peak[1]), days = Math.round((pk - d0) / 864e5);
      if (Math.abs(days) > 3) continue;
      const h = now.getHours(), night = (days === 0 && (h >= 20 || h < 5)) || (days === -1 && h < 5);
      return { ...sh, pk, days, night };
    }
    return null;
  }
  function nextShower(d0) {
    return SHOWERS.map(x => { let t = new Date(d0.getFullYear(), x.peak[0] - 1, x.peak[1]); if (t < d0) t = new Date(t.getFullYear() + 1, x.peak[0] - 1, x.peak[1]);
      return { ...x, pk: t, days: Math.round((t - d0) / 864e5) }; }).sort((a, b) => a.pk - b.pk)[0];
  }

  function moonGlyph(frac, waxing) {   // tiny phase glyph: dark disc + lit region (limb arc + terminator ellipse)
    const R = 10, k = 1 - 2 * frac, rx = Math.abs(k) * R;
    const lit = frac < .01 ? '' : frac > .99 ? `<circle r="${R}" fill="#e8e6df"/>`
      : `<path d="M0,${-R} A${R},${R} 0 0 1 0,${R} A${rx},${R} 0 0 ${k > 0 ? 0 : 1} 0,${-R}Z" fill="#e8e6df"/>`;
    return `<svg viewBox="-11 -11 22 22"><circle r="${R}" fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.18)" stroke-width=".6"/><g transform="scale(${waxing ? 1 : -1},1)">${lit}</g></svg>`;
  }
  const MOON_NAMES = ['新月', '二日月', '三日月', '三日月', '夕月', '夕月', '夕月', '上弦', '上弦', '十日夜', '十日夜', '十三夜', '十三夜', '小望月',
    '満月', '十六夜', '立待月', '居待月', '寝待月', '更待月', '更待月', '下弦', '下弦', '下弦', '有明月', '有明月', '有明月', '有明月', '晦月', '新月'];

  let m = null, C = null, lastKey = '';
  function render(force) {
    if (!m) return;
    const ctx = C, s = ctx.signals, U = Orbit.ui, kv = U.kv, set = ctx.settings;
    const now = new Date(), key = Math.floor(now / 60000) + '|' + JSON.stringify([s.iss && s.iss.ts, s.location, s.weather && s.weather.daily && s.weather.daily.sunrise]);
    if (!force && key === lastKey) return; lastKey = key;
    setLoc(s);
    const sol = solarSystem(now), L = lst(now, loc.lon), age = sol.moon.dlon / 360 * 29.53;
    const up = sol.planets.filter(pl => altAz(pl.ra, pl.dec, L).alt > 0).sort((a, b) => PLANET_LOOK[a.name][0] - PLANET_LOOK[b.name][0]).map(pl => pl.name);
    const sunUp = altAz(sol.sun.ra, sol.sun.dec, L).alt > 0;
    let h = `<div class="moonhd">${moonGlyph(sol.moon.frac, sol.moon.waxing)}<div><b>${MOON_NAMES[Math.min(29, Math.round(age))]}</b><span>月齢 ${age.toFixed(1)} · 輝面 ${Math.round(sol.moon.frac * 100)}%</span></div></div>`;
    h += kv('PLANETS', up.length ? up.join('・') + (sunUp ? '<small>昼間</small>' : '') : '<span style="opacity:.5">地平線の下</span>');
    const iss = s.iss;
    if (set.iss && iss && iss.lat != null) { const a = issAltAz(iss), deg = Math.round(a.alt * 180 / Math.PI);
      h += kv('ISS', deg > 0 ? `上空 ${deg}°<small>${iss.vis === 'daylight' ? '反射中' : '地球の影'}</small>` : `地平線の下<small>${Math.round(a.dist).toLocaleString()} km</small>`, deg > 10 && iss.vis === 'daylight' ? 'ok' : ''); }
    const shw = set.meteors ? (showerNow(now) || nextShower(U.day0())) : null;
    if (shw) h += kv('METEORS', `${shw.name.replace('流星群', '')} ${shw.peak[0]}/${shw.peak[1]}<small>${shw.night ? '今夜' : shw.days > 0 ? 'あと' + shw.days + '日' : shw.days === 0 ? '今日' : -shw.days + '日前'}</small>`, shw.night ? 'ok' : '');
    const w = s.weather;
    if (set.sun && w && w.daily && w.daily.sunrise && w.daily.sunset) h += kv('SUN', `↑ ${U.esc(String(w.daily.sunrise[0]).slice(11))}　↓ ${U.esc(String(w.daily.sunset[0]).slice(11))}`);
    m.body.innerHTML = h;
  }

  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'TONIGHT', 'm-tonight'); render(true); },
    on: {
      time() { render(false); },
      location() { render(true); },
      iss() { render(false); },
      weather() { render(false); },
    },
  });
})();
