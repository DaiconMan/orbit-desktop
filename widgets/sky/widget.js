/* SKY: tiny alt/az chart of the Sun, Moon, planets and ISS (zenith centre, north up, east left -
   as when looking up). Ported from the prototype wallpaper's "sky" module. Redrawn at most every 10 s,
   never animated. */
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

  // moon surface: grey disc, limb darkening, maria roughly where they are on the near side, small craters
  let MOON_TEX = null;
  function moonTex() {
    if (MOON_TEX) return MOON_TEX;
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), R = S / 2;
    g.save(); g.beginPath(); g.arc(R, R, R, 0, 6.283); g.clip();
    let gr = g.createRadialGradient(R * .85, R * .85, R * .1, R, R, R);
    gr.addColorStop(0, '#e9e8e3'); gr.addColorStop(.8, '#cfcdc6'); gr.addColorStop(1, '#9d9a92');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    const seas = [[.38, .30, .17], [.55, .40, .13], [.45, .52, .16], [.30, .55, .12], [.62, .58, .09], [.70, .33, .08], [.25, .40, .10], [.52, .70, .07]];
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [x, y, r] of seas) for (let k = 0; k < 14; k++) {
      const rr = r * S * (.4 + rnd() * .6), xx = x * S + (rnd() - .5) * r * S, yy = y * S + (rnd() - .5) * r * S;
      const sg = g.createRadialGradient(xx, yy, 0, xx, yy, rr);
      sg.addColorStop(0, 'rgba(95,98,105,.22)'); sg.addColorStop(1, 'rgba(95,98,105,0)');
      g.fillStyle = sg; g.beginPath(); g.arc(xx, yy, rr, 0, 6.283); g.fill();
    }
    for (let k = 0; k < 90; k++) {                       // craters: dark rim + light centre
      const xx = rnd() * S, yy = rnd() * S, rr = (rnd() ** 3) * 9 + 1.2;
      g.fillStyle = 'rgba(70,70,75,.18)'; g.beginPath(); g.arc(xx, yy, rr, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(255,255,250,.12)'; g.beginPath(); g.arc(xx - rr * .25, yy - rr * .25, rr * .6, 0, 6.283); g.fill();
    }
    gr = g.createRadialGradient(R, R, R * .7, R, R, R);   // limb darkening
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S); g.restore();
    return MOON_TEX = c;
  }
  const MOON_CANVAS = document.createElement('canvas'); MOON_CANVAS.width = MOON_CANVAS.height = 256;
  let moonPhaseKey = '';
  function renderMoon(frac, waxing) {
    const key = frac.toFixed(3) + waxing; if (key === moonPhaseKey) return MOON_CANVAS; moonPhaseKey = key;
    const S = 256, R = S / 2, g = MOON_CANVAS.getContext('2d');
    g.clearRect(0, 0, S, S); g.drawImage(moonTex(), 0, 0);
    // shadow mask: everything except the lit part, soft terminator, slight earthshine
    const mk = document.createElement('canvas'); mk.width = mk.height = S; const mg = mk.getContext('2d');
    mg.fillStyle = 'rgba(6,8,14,.9)'; mg.beginPath(); mg.arc(R, R, R + 1, 0, 6.283); mg.fill();
    mg.globalCompositeOperation = 'destination-out'; mg.filter = 'blur(3px)';
    const k = 1 - 2 * frac, dir = waxing ? 1 : -1;      // lit side: right when waxing (northern sky)
    mg.beginPath(); mg.arc(R, R, R, -Math.PI / 2, Math.PI / 2, dir < 0);
    mg.ellipse(R, R, Math.abs(k) * R, R, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === (dir > 0)); mg.fill();
    g.drawImage(mk, 0, 0); return MOON_CANVAS;
  }

  let m = null, C = null, cv = null, drawn = 0;
  function draw(force) {
    if (!m) return;
    const s = C.signals, set = C.settings;
    if (!force && drawn && Date.now() - drawn < 10000) return;
    const S = Math.round(cv.clientWidth * Math.max(2, window.devicePixelRatio || 1)); if (!S) return;
    drawn = Date.now(); cv.width = cv.height = S;
    setLoc(s);
    const now = new Date(), g = cv.getContext('2d'), R = S / 2 - 16, Cc = S / 2, sol = solarSystem(now), L = lst(now, loc.lon);
    const xy = (alt, az) => { const r = (Math.PI / 2 - alt) / (Math.PI / 2) * R; return [Cc - r * Math.sin(az), Cc - r * Math.cos(az)]; };
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1.2; g.beginPath(); g.arc(Cc, Cc, R, 0, 6.283); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.08)'; for (const k of [1 / 3, 2 / 3]) { g.beginPath(); g.arc(Cc, Cc, R * k, 0, 6.283); g.stroke(); }
    g.beginPath(); g.moveTo(Cc - R, Cc); g.lineTo(Cc + R, Cc); g.moveTo(Cc, Cc - R); g.lineTo(Cc, Cc + R); g.stroke();
    g.font = `500 ${S * .055}px ui-monospace, monospace`; g.fillStyle = 'rgba(255,255,255,.4)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [t, x, y] of [['N', Cc, Cc - R - 9], ['S', Cc, Cc + R + 9], ['E', Cc - R - 9, Cc], ['W', Cc + R + 9, Cc]]) g.fillText(t, x, y);
    const items = [], fs = S * .058;
    const dot = (alt, az, col, r, label, moon) => { if (alt <= 0) return; const [x, y] = xy(alt, az); items.push({ x, y, col, r, label, moon }); };
    const sun = altAz(sol.sun.ra, sol.sun.dec, L); dot(sun.alt, sun.az, '255,190,110', 5, '太陽');
    for (const pl of sol.planets) { const a = altAz(pl.ra, pl.dec, L); dot(a.alt, a.az, PLANET_LOOK[pl.name][1], PLANET_LOOK[pl.name][0] < -1 ? 3.6 : 2.6, pl.name); }
    const mo = altAz(sol.moon.ra, sol.moon.dec, L); dot(mo.alt, mo.az, '', 8, '月', true);
    if (set.iss && s.iss && s.iss.lat != null) { const a = issAltAz(s.iss); dot(a.alt, a.az, '160,255,200', 2.4, 'ISS'); }
    // marks first, then labels: each label tries right / left / above / below and is dropped if all collide
    const boxes = items.map(it => [it.x - it.r - 2, it.y - it.r - 2, it.x + it.r + 2, it.y + it.r + 2]);
    for (const it of items) {
      if (it.moon) g.drawImage(renderMoon(sol.moon.frac, sol.moon.waxing), it.x - it.r, it.y - it.r, it.r * 2, it.r * 2);
      else { g.fillStyle = `rgba(${it.col},.22)`; g.beginPath(); g.arc(it.x, it.y, it.r * 2.2, 0, 6.283); g.fill();
        g.fillStyle = `rgb(${it.col})`; g.beginPath(); g.arc(it.x, it.y, it.r, 0, 6.283); g.fill(); }
    }
    if (!set.labels) return;
    g.font = `${fs}px -apple-system, "Hiragino Sans", sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.62)';
    for (const it of items.sort((a, b) => b.r - a.r)) {
      const w = g.measureText(it.label).width, h = fs, o = it.r + 4;
      for (const [lx, ly] of [[it.x + o, it.y - h / 2], [it.x - o - w, it.y - h / 2], [it.x - w / 2, it.y - o - h], [it.x - w / 2, it.y + o]]) {
        const b = [lx, ly, lx + w, ly + h];
        if (b[0] < 0 || b[2] > S || b[1] < 0 || b[3] > S || boxes.some(q => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) continue;
        boxes.push(b); g.fillText(it.label, lx, ly + h / 2); break;
      }
    }
  }

  Orbit.widget({
    mount(ctx) {
      C = ctx; m = Orbit.module(ctx, 'SKY', 'm-sky'); m.meta.textContent = 'ALT / AZ';
      m.body.innerHTML = '<canvas class="skyc"></canvas>'; cv = m.body.firstChild;
      requestAnimationFrame(() => draw(true));
    },
    on: {
      time() { draw(false); },
      location() { draw(true); },
      iss() { draw(false); },
    },
    theme() { draw(true); },
  });
})();
