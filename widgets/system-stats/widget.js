/* System stats HUD with sparklines. Ping rows are created for whatever targets the host
   reports (configured in layout.yaml -> providers.ping.targets). */
(() => {
  const H = {}, el = {};
  const L = {
    en: { idle: 'IDLE', active: 'ACTIVE', busy: 'BUSY', hot: 'HIGH LOAD · RUNNING HOT', offline: 'OFFLINE', now: 'just now',
      min: n => `${n} min ago`, hr: n => `${n} h ago`, wait: 'speed test pending' },
    ja: { idle: 'IDLE', active: 'ACTIVE', busy: 'BUSY', hot: 'HIGH LOAD · RUNNING HOT', offline: 'OFFLINE', now: 'たった今',
      min: n => `${n}分前`, hr: n => `${n}時間前`, wait: '計測待ち' },
  };
  const fmtB = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB/s' : (b / 1e3).toFixed(0) + ' KB/s';
  const mbps = v => v >= 1000 ? (v / 1000).toFixed(2) + ' Gbps' : v.toFixed(0) + ' Mbps';
  function row(parent, key, label, kind = 'spark') {
    const r = document.createElement('div'); r.className = 'row';
    const k = document.createElement('span'); k.className = 'k'; k.textContent = label;
    const g = kind === 'spark' ? document.createElement('canvas') : Object.assign(document.createElement('div'), { className: 'meter', innerHTML: '<i></i>' });
    const v = document.createElement('span'); v.className = 'v'; v.textContent = '–';
    r.append(k, g, v); parent.appendChild(r);
    return el[key] = { r, g, v, bar: g.querySelector && g.querySelector('i') };
  }
  function spark(key, val, max, color) { H[key] = Orbit.spark(el[key].g, H[key] || [], val, max, color); }
  Orbit.widget({
    mount(ctx) {
      const s = ctx.settings, R = ctx.root;
      R.innerHTML = '<div class="hud"><div class="status"><span class="dot"></span><span class="st">IDLE</span></div><div class="main"></div><div class="pings"></div><div class="speed"></div></div>';
      el.hud = R.querySelector('.hud'); el.st = R.querySelector('.st');
      R.querySelector('.status').hidden = !s.show_status;
      const m = R.querySelector('.main');
      row(m, 'cpu', 'CPU'); row(m, 'mem', 'MEMORY');
      if (s.show_disk) row(m, 'disk', 'DISK I/O');
      if (s.show_network) { row(m, 'rx', 'NET ↓'); row(m, 'tx', 'NET ↑'); }
      el.pings = R.querySelector('.pings'); el.speed = R.querySelector('.speed');
    },
    on: {
      system(d, ctx) {
        const s = ctx.settings, l = L[ctx.lang] || L.en;
        const c = `rgb(${ctx.rgb('c')})`, w = 'rgba(255,255,255,.75)';
        if (d.cpu != null) { spark('cpu', d.cpu, 100, c); el.cpu.v.textContent = d.cpu.toFixed(0) + '%'; }
        if (d.mem) { spark('mem', d.mem.pct, 100, w); el.mem.v.textContent = (d.mem.used / 2 ** 30).toFixed(1) + ' GB'; }
        if (el.disk && d.disk) { spark('disk', d.disk.mbs, 0, w); el.disk.v.textContent = d.disk.mbs.toFixed(1) + ' MB/s'; }
        if (el.rx && d.net && d.net.rx != null) {
          spark('rx', d.net.rx, 0, c); el.rx.v.textContent = fmtB(d.net.rx);
          spark('tx', d.net.tx, 0, `rgb(${ctx.rgb('b')})`); el.tx.v.textContent = fmtB(d.net.tx);
        }
        if (s.show_ping && d.ping) {
          for (const [name, v] of Object.entries(d.ping)) {
            const key = 'ping:' + name;
            if (!el[key]) { if (!el.pings.firstChild) el.pings.appendChild(Object.assign(document.createElement('div'), { className: 'sep' })); row(el.pings, key, name.toUpperCase()); }
            spark(key, v == null ? 0 : v, 0, v == null ? '#ff5a6e' : w);
            el[key].v.textContent = v == null ? l.offline : v.toFixed(0) + ' ms';
          }
        }
        if (s.show_speed && d.speed) {
          if (!el.dl) {
            el.speed.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
            row(el.speed, 'dl', 'SPEED ↓', 'meter'); row(el.speed, 'ul', 'SPEED ↑', 'meter');
            el.at = Object.assign(document.createElement('div'), { className: 'row at' }); el.speed.appendChild(el.at);
          }
          for (const k of ['dl', 'ul']) {
            el[k].v.textContent = mbps(d.speed[k]);
            el[k].bar.style.width = Math.min(100, d.speed[k] / s.speed_full_scale_mbps * 100) + '%';
            el[k].bar.style.background = c;
          }
          const ago = Math.round((Date.now() / 1000 - d.speed.at) / 60);
          el.at.textContent = 'networkQuality · ' + (ago < 1 ? l.now : ago < 60 ? l.min(ago) : l.hr(Math.round(ago / 60)));
        }
        const cpu = d.cpu || 0;
        el.hud.classList.toggle('busy', cpu >= 70);
        el.st.textContent = cpu >= 70 ? l.hot : cpu >= 45 ? l.busy : cpu >= 15 ? l.active : l.idle;
      },
    },
  });
})();
