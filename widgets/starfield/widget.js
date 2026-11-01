/* Starfield background - the real sky over your location.
 * Stars (mag <= 6, d3-celestial / Yale BSC, BSD) placed by alt/az for the current place & time,
 * zenith-centred azimuthal projection (north up, east left - as when looking up), plus the Milky Way,
 * planets & Moon (Schlyter's simplified orbital elements, ~1 deg), Sgr A*, meteors, network
 * streamlines and an occasional UFO.
 *
 * Reaction hooks (all 0..1, mapped from signals by `react:` in layout.yaml):
 *   twinkle     - star twinkle strength & speed          (default: cpu)
 *   meteors     - shooting-star rate                     (default: cpu)
 *   heat        - warm glow from the bottom + edge pulse (default: cpu)
 *   streamlines - number / speed / length of flow lines  (default: net)
 *   glow        - Milky Way + bright-star glow           (default: audio.bass)
 */
(() => {
  'use strict';
  const rad = Math.PI / 180, D2R = rad, R2D = 180 / Math.PI, n360 = x => ((x % 360) + 360) % 360;
  let S, W, H, DPR = 1, cx;
  let loc = null, SKY = null, VIS = [], skyLayer = null, mwLayer = null, mwGlow = 1, skyAt = 0, skyL = 0, rotSign = 1;
  let SOLAR = null, UFO = null, nextUfo = Date.now() + 60000 + Math.random() * 180000;
  let T0 = Date.now(), overlays = {}, lastOverlay = 0;
  const skyNow = () => new Date(T0 + (Date.now() - T0) * (S.time_scale || 1));

  function bvRGB(bv) {          // B-V colour index -> approximate star colour
    bv = Math.max(-.4, Math.min(2, +bv || .6));
    const t = (bv + .4) / 2.4;
    const r = 180 + 75 * Math.min(1, t * 1.8), g = 200 + 40 * (1 - Math.abs(t - .35) * 2), b = 255 - 150 * Math.max(0, t - .25);
    return `${r | 0},${Math.max(150, g) | 0},${Math.max(90, b) | 0}`;
  }
  function lst(date, lonDeg) {  // local sidereal time in degrees
    const jd = date.getTime() / 86400000 + 2440587.5;
    return ((280.46061837 + 360.98564736629 * (jd - 2451545) + lonDeg) % 360 + 360) % 360;
  }
  function project(raDeg, decDeg, LST) {
    const ha = (LST - raDeg) * rad, dec = decDeg * rad, la = loc.lat * rad;
    const alt = Math.asin(Math.sin(dec) * Math.sin(la) + Math.cos(dec) * Math.cos(la) * Math.cos(ha));
    if (alt < -0.02) return null;
    const az = Math.atan2(-Math.sin(ha) * Math.cos(dec), Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(ha));
    const r = (Math.PI / 2 - alt) / (Math.PI / 2) * Math.max(W, H) * .62;
    return [W / 2 - r * Math.sin(az), H * .55 - r * Math.cos(az)];
  }

  /* ---------- solar system (Schlyter's simplified orbital elements, ~1 deg accuracy) ---------- */
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
  // name: [en, ja, typical magnitude, colour]
  const PLANET_LOOK = { mercury: ['Mercury', '水星', -.2, '235,225,210'], venus: ['Venus', '金星', -4.2, '255,252,240'],
    mars: ['Mars', '火星', .4, '255,170,120'], jupiter: ['Jupiter', '木星', -2.3, '255,240,215'], saturn: ['Saturn', '土星', .6, '245,230,185'] };
  function solarSystem(date) {
    const d = date.getTime() / 86400000 + 2440587.5 - 2451543.5, ecl = (23.4393 - 3.563e-7 * d) * D2R;
    const ws = 282.9404 + 4.70935e-5 * d, es = .016709 - 1.151e-9 * d, Ms = 356.0470 + .9856002585 * d;
    const sun = orb(0, 0, ws, 1, es, Ms);                       // geocentric Sun
    const P = {
      mercury: [48.3313 + 3.24587e-5 * d, 7.0047 + 5e-8 * d, 29.1241 + 1.01444e-5 * d, .387098, .205635 + 5.59e-10 * d, 168.6562 + 4.0923344368 * d],
      venus: [76.6799 + 2.4659e-5 * d, 3.3946 + 2.75e-8 * d, 54.891 + 1.38374e-5 * d, .72333, .006773 - 1.302e-9 * d, 48.0052 + 1.6021302244 * d],
      mars: [49.5574 + 2.11081e-5 * d, 1.8497 - 1.78e-8 * d, 286.5016 + 2.92961e-5 * d, 1.523688, .093405 + 2.516e-9 * d, 18.6021 + .5240207766 * d],
      jupiter: [100.4542 + 2.76854e-5 * d, 1.303 - 1.557e-7 * d, 273.8777 + 1.64505e-5 * d, 5.20256, .048498 + 4.469e-9 * d, 19.895 + .0830853001 * d],
      saturn: [113.6634 + 2.3898e-5 * d, 2.4886 - 1.081e-7 * d, 339.3939 + 2.97661e-5 * d, 9.55475, .055546 - 9.499e-9 * d, 316.967 + .0334442282 * d],
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
    const waxing = n360(Math.atan2(moon[1], moon[0]) * R2D - Math.atan2(sun[1], sun[0]) * R2D) < 180;
    return { planets: out, moon: { ra: mra, dec: mdec, frac: (1 - Math.cos(elong)) / 2, waxing }, sun: { ra: sra, dec: sdec } };
  }

  /* ---------- Milky Way: points sampled in galactic coordinates -> equatorial (J2000) ---------- */
  const GAL2EQ = [[-.0548755604, .4941094279, -.867666149], [-.8734370902, -.44482963, -.1980763734], [-.4838350155, .7469822445, .4559837762]];
  function galToRaDec(l, b) {
    const x = Math.cos(b) * Math.cos(l), y = Math.cos(b) * Math.sin(l), z = Math.sin(b);
    const X = GAL2EQ[0][0] * x + GAL2EQ[0][1] * y + GAL2EQ[0][2] * z, Y = GAL2EQ[1][0] * x + GAL2EQ[1][1] * y + GAL2EQ[1][2] * z, Z = GAL2EQ[2][0] * x + GAL2EQ[2][1] * y + GAL2EQ[2][2] * z;
    return [n360(Math.atan2(Y, X) * R2D), Math.asin(Z) * R2D];
  }
  const MILKY = [];
  for (let i = 0; i < 5000; i++) {
    const l = Math.random() * 2 * Math.PI;
    const centre = Math.cos(l) > 0 ? Math.cos(l) ** 3 : 0;               // denser toward the galactic centre
    if (Math.random() > .35 + .65 * centre) { i--; continue; }
    const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // ~gaussian
    const [ra, dec] = galToRaDec(l, g * (6 + 10 * centre) * D2R);
    MILKY.push({ ra, dec, a: .02 + Math.random() * .05 * (1 + centre) });
  }
  const SGRA = { ra: 266.4168, dec: -29.0078 };   // Sagittarius A*, the Milky Way's central black hole

  /* ---------- sprites (prerendered once: cheap to stamp) ---------- */
  function makeGlow(rgb, size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(.25, `rgba(${rgb},.35)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, size, size); return c;
  }
  const GLOWS = {};
  const glow = (rgb, size = 64) => GLOWS[rgb + size] || (GLOWS[rgb + size] = makeGlow(rgb, size));
  const MW_SPRITE = makeGlow('190,200,255', 64);
  const MOON_TEX = (() => {   // grey disc, limb darkening, maria roughly where they are on the near side, craters
    const Sz = 256, c = document.createElement('canvas'); c.width = c.height = Sz;
    const g = c.getContext('2d'), R = Sz / 2;
    g.save(); g.beginPath(); g.arc(R, R, R, 0, 6.283); g.clip();
    let gr = g.createRadialGradient(R * .85, R * .85, R * .1, R, R, R);
    gr.addColorStop(0, '#e9e8e3'); gr.addColorStop(.8, '#cfcdc6'); gr.addColorStop(1, '#9d9a92');
    g.fillStyle = gr; g.fillRect(0, 0, Sz, Sz);
    const seas = [[.38, .30, .17], [.55, .40, .13], [.45, .52, .16], [.30, .55, .12], [.62, .58, .09], [.70, .33, .08], [.25, .40, .10], [.52, .70, .07]];
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [x, y, r] of seas) for (let k = 0; k < 14; k++) {
      const rr = r * Sz * (.4 + rnd() * .6), xx = x * Sz + (rnd() - .5) * r * Sz, yy = y * Sz + (rnd() - .5) * r * Sz;
      const sg = g.createRadialGradient(xx, yy, 0, xx, yy, rr);
      sg.addColorStop(0, 'rgba(95,98,105,.22)'); sg.addColorStop(1, 'rgba(95,98,105,0)');
      g.fillStyle = sg; g.beginPath(); g.arc(xx, yy, rr, 0, 6.283); g.fill();
    }
    for (let k = 0; k < 90; k++) {
      const xx = rnd() * Sz, yy = rnd() * Sz, rr = (rnd() ** 3) * 9 + 1.2;
      g.fillStyle = 'rgba(70,70,75,.18)'; g.beginPath(); g.arc(xx, yy, rr, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(255,255,250,.12)'; g.beginPath(); g.arc(xx - rr * .25, yy - rr * .25, rr * .6, 0, 6.283); g.fill();
    }
    gr = g.createRadialGradient(R, R, R * .7, R, R, R);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = gr; g.fillRect(0, 0, Sz, Sz); g.restore(); return c;
  })();
  const MOON_CANVAS = document.createElement('canvas'); MOON_CANVAS.width = MOON_CANVAS.height = 256;
  let moonPhaseKey = '';
  function renderMoon(frac, waxing) {
    const key = frac.toFixed(3) + waxing; if (key === moonPhaseKey) return MOON_CANVAS; moonPhaseKey = key;
    const Sz = 256, R = Sz / 2, g = MOON_CANVAS.getContext('2d');
    g.clearRect(0, 0, Sz, Sz); g.drawImage(MOON_TEX, 0, 0);
    const m = document.createElement('canvas'); m.width = m.height = Sz; const mg = m.getContext('2d');
    mg.fillStyle = 'rgba(6,8,14,.9)'; mg.beginPath(); mg.arc(R, R, R + 1, 0, 6.283); mg.fill();
    mg.globalCompositeOperation = 'destination-out'; mg.filter = 'blur(3px)';
    const k = 1 - 2 * frac, dir = waxing ? 1 : -1;      // lit side: right when waxing (northern sky)
    mg.beginPath(); mg.arc(R, R, R, -Math.PI / 2, Math.PI / 2, dir < 0);
    mg.ellipse(R, R, Math.abs(k) * R, R, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === (dir > 0)); mg.fill();
    g.drawImage(m, 0, 0); return MOON_CANVAS;
  }

  function buildSky() {
    if (!SKY || !loc) return;
    const L = lst(skyNow(), loc.lon); skyL = L;
    { const pp = project(0, 89.99, L), a1 = project(90, 60, L), a2 = project(90, 60, L + .5);
      if (pp && a1 && a2) rotSign = Math.sign(Math.atan2(a2[1] - pp[1], a2[0] - pp[0]) - Math.atan2(a1[1] - pp[1], a1[0] - pp[0])) || 1; }
    skyLayer = skyLayer || document.createElement('canvas'); skyLayer.width = W; skyLayer.height = H;
    const g = skyLayer.getContext('2d'); g.clearRect(0, 0, W, H);
    mwLayer = mwLayer || document.createElement('canvas'); mwLayer.width = W; mwLayer.height = H;
    { const mg = mwLayer.getContext('2d'); mg.clearRect(0, 0, W, H);
      if (S.milky_way) for (const m of MILKY) {
        const q = project(m.ra, m.dec, L); if (!q) continue;
        const r = (10 + (m.a * 997 % 1) * 14) * DPR;
        mg.globalAlpha = m.a; mg.drawImage(MW_SPRITE, q[0] - r, q[1] - r, r * 2, r * 2);
      }
      mg.globalAlpha = 1; }
    SOLAR = solarSystem(skyNow());
    VIS = [];
    for (const f of SKY.features) {
      const [ra, dec] = f.geometry.coordinates, m = f.properties.mag;
      const q = project(ra < 0 ? ra + 360 : ra, dec, L); if (!q) continue;
      const st = { x: q[0], y: q[1], r: Math.max(.35, (6.4 - m) * .42) * DPR, c: bvRGB(f.properties.bv), m, tw: (f.id * 2.399) % 6.28, ts: .4 + (f.id % 7) * .2 };
      if (m < 4.0) VIS.push(st);   // brighter stars: drawn live (twinkle, glow)
      else { g.fillStyle = `rgba(${st.c},${Math.min(.8, .85 - (m - 4.0) * .2)})`; g.beginPath(); g.arc(st.x, st.y, st.r, 0, 6.283); g.fill(); }
    }
    skyAt = Date.now();
  }

  // laminar flow: direction varies smoothly and only slowly in time (no swirling)
  const flowAngle = (x, y, t) => -.12 + .32 * Math.sin(y * 5.5 + x * 2.2 + t * .04) + .12 * Math.sin(x * 3.1 - t * .03);
  const LINES = [], shooters = [];
  function newLine(l, anywhere) {
    l.x = anywhere ? Math.random() : -.05 - Math.random() * .1; l.y = Math.random();
    l.v = .35 + Math.random() * .65; l.hue = Math.random(); l.pts = []; return l;
  }

  function setupOverlays(root) {
    for (const k of ['vignette', 'heat', 'pulse', 'scan']) {
      const d = document.createElement('div'); d.className = 'sf-' + k; root.appendChild(d); overlays[k] = d;
    }
    overlays.vignette.hidden = !S.vignette; overlays.scan.hidden = !S.scanlines;
    overlays.heat.hidden = overlays.pulse.hidden = !S.heat_glow;
  }

  Orbit.background({
    fps: 30,
    setup(ctx) {
      S = ctx.settings; cx = ctx.g; W = ctx.W; H = ctx.H; DPR = ctx.DPR;
      SKY = ctx.assets['data/stars.6.json'] || null;
      for (let i = 0; i < S.streamline_count; i++) LINES.push(newLine({}, true));
      if (!S.ufo) nextUfo = Infinity;
      setupOverlays(ctx.root);
    },
    resize(ctx) { W = ctx.W; H = ctx.H; buildSky(); },
    on: {
      location(l) {
        if (!l || typeof l.lat !== 'number') return;
        if (!loc || Math.abs(l.lat - loc.lat) > .05 || Math.abs(l.lon - loc.lon) > .05) { loc = { lat: l.lat, lon: l.lon }; buildSky(); }
      },
    },
    frame(ctx, f) {
      const { t, dt, react } = f;
      const palette = [ctx.rgb('a'), ctx.rgb('b'), ctx.rgb('c')];
      const load = react.twinkle, net = react.streamlines, beat = react.glow ** 2;

      cx.globalCompositeOperation = 'source-over';
      cx.fillStyle = '#04050a'; cx.fillRect(0, 0, W, H);
      if (!loc) return;

      // ---- real sky; twinkle hook = twinkle strength & speed ----
      const Lnow = lst(skyNow(), loc.lon);
      let dL = ((Lnow - skyL + 540) % 360) - 180;
      if (SKY && (Math.abs(dL) > 2 || Date.now() - skyAt > 600000)) { buildSky(); dL = 0; }
      const pole = project(0, 89.99, Lnow) || [W / 2, H / 2];
      cx.save(); cx.translate(pole[0], pole[1]); cx.rotate(rotSign * dL * Math.PI / 180); cx.translate(-pole[0], -pole[1]);
      // glow hook: the Milky Way breathes (instant attack, slow release)
      { const tgt = 1 + react.glow * .9 + beat * .6; mwGlow = tgt > mwGlow ? tgt : mwGlow + (tgt - mwGlow) * .12; }
      if (mwLayer) { cx.globalAlpha = Math.min(1, .55 * mwGlow); cx.drawImage(mwLayer, 0, 0); if (mwGlow > 1.8) { cx.globalAlpha = (mwGlow - 1.8) * .5; cx.drawImage(mwLayer, 0, 0); } cx.globalAlpha = 1; }
      if (skyLayer) cx.drawImage(skyLayer, 0, 0);
      const twAmp = .12 + load * .7, twSpd = 1 + load * 4;
      for (const st of VIS) {
        const ph = Math.sin(t * st.ts * twSpd + st.tw) * .5 + Math.sin(t * st.ts * twSpd * 2.7 + st.tw * 3) * .5;
        const base = Math.min(1, .95 - (st.m - 1) * .1);
        const a = Math.max(0, Math.min(1, base * (1 - twAmp * .5 + twAmp * .5 * ph) * (1 + beat * .6 * (st.m < 2.5))));
        const r = st.r * (1 + (st.m < 2.5 ? beat * .45 : 0));
        cx.fillStyle = `rgba(${st.c},${a})`; cx.beginPath(); cx.arc(st.x, st.y, r, 0, 6.283); cx.fill();
        if (st.m < 1.5) { cx.fillStyle = `rgba(${st.c},${a * (.08 + beat * .12)})`; cx.beginPath(); cx.arc(st.x, st.y, r * 5, 0, 6.283); cx.fill(); }
      }
      cx.restore();

      // ---- solar system & black hole (projected live, so they move smoothly too) ----
      if (SOLAR) {
        cx.textBaseline = 'middle';
        if (S.planets) for (const pl of SOLAR.planets) {
          const q = project(pl.ra, pl.dec, Lnow); if (!q) continue;
          const [en, ja, mag, c] = PLANET_LOOK[pl.name];
          const core = Math.max(1.1, (1.6 - mag * .55)) * DPR * (1 + beat * .2);
          const glowR = core * (mag < -1 ? 9 : 5);
          cx.globalAlpha = mag < -1 ? .55 : .35; cx.drawImage(glow(c), q[0] - glowR, q[1] - glowR, glowR * 2, glowR * 2); cx.globalAlpha = 1;
          cx.fillStyle = `rgb(${c})`; cx.beginPath(); cx.arc(q[0], q[1], core, 0, 6.283); cx.fill();
          if (mag < -1.5) {                                   // faint diffraction spikes on very bright planets
            const L2 = core * (mag < -3 ? 10 : 7);
            for (const [dx, dy] of [[1, 0], [0, 1]]) {
              const sg = cx.createLinearGradient(q[0] - dx * L2, q[1] - dy * L2, q[0] + dx * L2, q[1] + dy * L2);
              sg.addColorStop(0, `rgba(${c},0)`); sg.addColorStop(.5, `rgba(${c},.45)`); sg.addColorStop(1, `rgba(${c},0)`);
              cx.strokeStyle = sg; cx.lineWidth = .7 * DPR; cx.beginPath(); cx.moveTo(q[0] - dx * L2, q[1] - dy * L2); cx.lineTo(q[0] + dx * L2, q[1] + dy * L2); cx.stroke();
            }
          }
          if (S.labels) {
            cx.font = `${9 * DPR}px ${ctx.theme.font || 'sans-serif'}`; cx.fillStyle = 'rgba(255,255,255,.22)';
            cx.fillText(ctx.lang === 'ja' ? ja : en, q[0] + glowR * .5 + 4 * DPR, q[1] - glowR * .35);
          }
        }
        const mq = S.moon && project(SOLAR.moon.ra, SOLAR.moon.dec, Lnow);
        if (mq) {
          const R = 20 * DPR, fr = SOLAR.moon.frac;
          cx.globalAlpha = .05 + fr * .18; const hr = R * 6;
          cx.drawImage(glow('225,230,245', 128), mq[0] - hr, mq[1] - hr, hr * 2, hr * 2);
          cx.globalAlpha = 1;
          cx.drawImage(renderMoon(fr, SOLAR.moon.waxing), mq[0] - R, mq[1] - R, R * 2, R * 2);
        }
        const bq = S.black_hole && project(SGRA.ra, SGRA.dec, Lnow);
        if (bq) {   // black hole: dark core, photon ring, tilted accretion disc, faint glow
          const R = 9 * DPR, spin = t * .6;
          const gl = cx.createRadialGradient(bq[0], bq[1], R, bq[0], bq[1], R * 6);
          gl.addColorStop(0, 'rgba(255,170,90,.25)'); gl.addColorStop(1, 'rgba(255,170,90,0)');
          cx.fillStyle = gl; cx.beginPath(); cx.arc(bq[0], bq[1], R * 6, 0, 6.283); cx.fill();
          cx.save(); cx.translate(bq[0], bq[1]); cx.rotate(spin * .1);
          cx.strokeStyle = 'rgba(255,190,120,.55)'; cx.lineWidth = 2 * DPR;
          cx.beginPath(); cx.ellipse(0, 0, R * 2.6, R * .7, 0, 0, 6.283); cx.stroke();
          cx.restore();
          cx.strokeStyle = `rgba(255,220,170,${.7 + .3 * Math.sin(t * 2)})`; cx.lineWidth = 1.5 * DPR;
          cx.beginPath(); cx.arc(bq[0], bq[1], R * 1.15, 0, 6.283); cx.stroke();
          cx.fillStyle = '#000'; cx.beginPath(); cx.arc(bq[0], bq[1], R, 0, 6.283); cx.fill();
          if (S.labels) { cx.font = `${9 * DPR}px ${ctx.theme.mono_font || 'monospace'}`; cx.fillStyle = 'rgba(255,200,150,.3)'; cx.fillText('Sgr A*', bq[0] + R * 3, bq[1] - R * 1.5); }
        }
      }

      // ---- UFO (easter egg, every few minutes) ----
      if (!UFO && Date.now() > nextUfo) {
        const ltr = Math.random() < .5, y = H * (.15 + Math.random() * .5);
        UFO = { x: ltr ? -60 * DPR : W + 60 * DPR, y, vx: (ltr ? 1 : -1) * W / (9 + Math.random() * 6), ph: Math.random() * 6 };
      }
      if (UFO) {
        UFO.x += UFO.vx * dt; UFO.ph += dt;
        const x = UFO.x, y = UFO.y + Math.sin(UFO.ph * 1.7) * 12 * DPR, s = DPR * 1.2;
        if (Math.sin(UFO.ph * .9) > .55) {   // tractor beam now and then
          const bm = cx.createLinearGradient(x, y, x, y + 140 * s);
          bm.addColorStop(0, 'rgba(140,255,200,.25)'); bm.addColorStop(1, 'rgba(140,255,200,0)');
          cx.fillStyle = bm; cx.beginPath(); cx.moveTo(x - 8 * s, y + 4 * s); cx.lineTo(x + 8 * s, y + 4 * s); cx.lineTo(x + 40 * s, y + 140 * s); cx.lineTo(x - 40 * s, y + 140 * s); cx.fill();
        }
        cx.fillStyle = 'rgba(170,230,255,.55)'; cx.beginPath(); cx.ellipse(x, y - 5 * s, 9 * s, 7 * s, 0, Math.PI, 0); cx.fill();
        cx.fillStyle = 'rgba(200,210,225,.9)'; cx.beginPath(); cx.ellipse(x, y, 24 * s, 6 * s, 0, 0, 6.283); cx.fill();
        for (let i = 0; i < 5; i++) {
          cx.fillStyle = Math.sin(UFO.ph * 6 + i) > 0 ? 'rgba(255,230,120,1)' : 'rgba(120,120,140,.8)';
          cx.beginPath(); cx.arc(x - 16 * s + i * 8 * s, y + 1.5 * s, 1.6 * s, 0, 6.283); cx.fill();
        }
        if (UFO.x < -80 * DPR || UFO.x > W + 80 * DPR) { UFO = null; nextUfo = Date.now() + 240000 + Math.random() * 360000; }
      }

      // ---- streamlines hook = count & speed of flow lines ----
      const active = Math.round(net * LINES.length * 80 / 90);
      const speed = .03 + net * .14, maxPts = 20 + Math.round(net * 40);
      cx.lineCap = 'round';
      for (let i = 0; i < LINES.length; i++) {
        const l = LINES[i];
        if (i >= active) { if (l.pts.length) l.pts.shift(); else { if (l.x > 0) newLine(l, false); continue; } }
        else {
          const ang = flowAngle(l.x, l.y, t);
          l.x += Math.cos(ang) * speed * l.v * dt; l.y += Math.sin(ang) * speed * l.v * dt * .6;
          l.pts.push([l.x * W, l.y * H]); if (l.pts.length > maxPts) l.pts.splice(0, l.pts.length - maxPts);
          if (l.x > 1.08 || l.y < -.1 || l.y > 1.1) { newLine(l, false); continue; }
        }
        if (l.pts.length < 3) continue;
        const c = l.hue < .5 ? palette[2] : l.hue < .8 ? palette[0] : palette[1];
        const base = (.08 + l.v * .2) * (.6 + net * .6);
        for (let j = 1; j < l.pts.length; j++) {
          const k = j / l.pts.length;
          cx.strokeStyle = `rgba(${c},${Math.min(.8, base * k * k)})`; cx.lineWidth = (.5 + l.v * 1.1 * k) * DPR;
          cx.beginPath(); cx.moveTo(l.pts[j - 1][0], l.pts[j - 1][1]); cx.lineTo(l.pts[j][0], l.pts[j][1]); cx.stroke();
        }
      }

      // ---- meteors hook = shooting stars (meteor shower when busy) ----
      if (S.meteors && Math.random() < .0008 + react.meteors ** 1.5 * .07) shooters.push({ x: Math.random() * W, y: Math.random() * H * .5,
        vx: (Math.random() < .5 ? -1 : 1) * (.5 + Math.random() * .6) * W, vy: H * (.2 + Math.random() * .3), life: 1 });
      for (let i = shooters.length - 1; i >= 0; i--) {
        const m = shooters[i]; m.life -= dt * 1.5;
        if (m.life <= 0) { shooters.splice(i, 1); continue; }
        const x2 = m.x + m.vx * dt, y2 = m.y + m.vy * dt, tx = m.x - m.vx * .15, ty = m.y - m.vy * .15;
        const g = cx.createLinearGradient(tx, ty, x2, y2);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,255,255,${m.life * .85})`);
        cx.strokeStyle = g; cx.lineWidth = 1.3 * DPR; cx.beginPath(); cx.moveTo(tx, ty); cx.lineTo(x2, y2); cx.stroke();
        m.x = x2; m.y = y2;
      }

      // ---- heat hook = warm glow from the bottom + pulsing edges (DOM overlays, updated ~2x/s) ----
      if (S.heat_glow && f.t - lastOverlay > .5) {
        lastOverlay = f.t;
        overlays.heat.style.opacity = Math.max(0, (react.heat - .2) / .8).toFixed(2);
        document.body.classList.toggle('hot', react.heat > .7);
      }
    },
  });
})();
