/* HOME NET: HOME/AWAY, Tailscale, NAS shares, pings, speed test (ported from the prototype's HOME NET module).
   Share names and ping targets come from the signal (whatever the host reports), nothing is hard-coded. */
(() => {
  const U = Orbit.ui, E = U.esc;
  let m = null, el = {}, pingKeys = '', mountKeys = '';
  const row = (cls, inner) => `<div class="row${cls ? ' ' + cls : ''}">${inner}</div>`;
  function build(ping, mounts) {
    const pk = Object.keys(ping || {}), mk = Object.keys(mounts || {});
    pingKeys = pk.join('\n'); mountKeys = mk.join('\n');
    m.body.innerHTML =
      row('', '<span class="k">TAILSCALE</span><span class="k ip"></span><span class="v ts">–</span>') +
      (mk.length ? row('lan', '<span class="k">NAS SHARES</span><span class="v mounts" style="grid-column: 2 / 4">–</span>') : '') +
      pk.map((k, i) => row('lan', `<span class="k">${E(k.toUpperCase())}</span><canvas id="g-p${i}"></canvas><span class="v" id="v-p${i}">–</span>`)).join('') +
      row('', '<span class="k">SPEED ↓</span><div class="meter"><i class="m-dl"></i></div><span class="v v-dl">–</span>') +
      row('', '<span class="k">SPEED ↑</span><div class="meter"><i class="m-ul"></i></div><span class="v v-ul">–</span>') +
      '<div class="foot at" style="text-align:right"></div>';
    const q = s => m.body.querySelector(s);
    el = { ip: q('.ip'), ts: q('.ts'), mounts: q('.mounts'), at: q('.at'), dl: [q('.v-dl'), q('.m-dl')], ul: [q('.v-ul'), q('.m-ul')] };
  }
  Orbit.widget({
    mount(ctx) { m = Orbit.module(ctx, 'HOME NET', 'm-homenet'); build({}, {}); },
    on: {
      network(s, ctx) {
        if (!s) return;
        const c = `rgb(${ctx.rgb('c')})`, w = 'rgba(255,255,255,.75)';
        const ping = s.ping || {}, mounts = s.mounts || {};
        if (Object.keys(ping).join('\n') !== pingKeys || Object.keys(mounts).join('\n') !== mountKeys) build(ping, mounts);
        if (s.home) { m.meta.textContent = s.home.home ? 'HOME' : 'AWAY'; m.el.classList.toggle('away', !s.home.home); }
        Object.keys(ping).forEach((k, i) => { const v = ping[k];
          U.spark('g-p' + i, v ?? 0, 0, v == null ? '#ff5a6e' : w);
          document.getElementById('v-p' + i).textContent = v == null ? 'OFFLINE' : v.toFixed(0) + ' ms'; });
        if (s.tailscale) { const on = s.tailscale.up;
          el.ts.innerHTML = on ? `<span style="color:${c}">● ON</span>` : '<span style="color:#ff8a7a">○ OFF</span>';
          el.ip.textContent = on ? (s.tailscale.ip || '') : ''; }
        if (el.mounts) {        // each share is a button: click = mount / unmount (done by the host app)
          const can = s.mountable || {};
          el.mounts.innerHTML = Object.keys(mounts).map(n => `<button type="button" class="mnt ${mounts[n] ? 'on' : ''}" data-n="${E(n)}" ${!mounts[n] && !can[n] ? 'disabled' : ''} title="${mounts[n] ? 'クリックで取り外す' : can[n] ? 'クリックでマウント' : '一度マウントすると、ここからマウントできます'}">${mounts[n]
            ? `<span style="color:${c}">●</span> ${E(n.toUpperCase())}` : `<span style="opacity:.45">○ ${E(n.toUpperCase())}</span>`}</button>`).join('');
          for (const b of el.mounts.querySelectorAll('button.mnt')) b.onclick = () => { ctx.action('mount', b.dataset.n); b.classList.add('busy'); };
        }
        if (s.speed) {
          const mbps = v => v >= 1000 ? (v / 1000).toFixed(2) + ' Gbps' : v.toFixed(0) + ' Mbps', full = ctx.settings.speed_full_scale_mbps;
          for (const [k, v] of [['dl', s.speed.dl], ['ul', s.speed.ul]]) { if (v == null) continue;
            el[k][0].textContent = mbps(v); el[k][1].style.width = Math.min(100, v / full * 100) + '%'; el[k][1].style.background = c; }
          el.at.textContent = s.speed.at ? `networkQuality · ${U.agoTxt(s.speed.at)}` : 'networkQuality';
        } else el.at.textContent = '計測待ち（電源接続時に1時間ごと）';
      },
    },
  });
})();
