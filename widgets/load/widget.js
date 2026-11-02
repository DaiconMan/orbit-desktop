/* LOAD: CPU / MEMORY / DISK I/O / NET sparklines (ported from the prototype's LOAD module). */
(() => {
  const U = Orbit.ui;
  let m = null;
  const $ = id => document.getElementById(id);
  Orbit.widget({
    mount(ctx) {
      m = Orbit.module(ctx, 'LOAD', 'm-load');
      m.body.innerHTML = [['CPU', 'cpu'], ['MEMORY', 'mem'], ['DISK I/O', 'disk'], ['NET ↓', 'rx'], ['NET ↑', 'tx']]
        .map(([k, id]) => `<div class="row"><span class="k">${k}</span><canvas id="g-${id}"></canvas><span class="v" id="v-${id}">–</span></div>`).join('');
      m.meta.innerHTML = '<span class="dot"></span>IDLE';
    },
    on: {
      system(s, ctx) {
        if (!s) return;
        const c = `rgb(${ctx.rgb('c')})`, w = 'rgba(255,255,255,.75)';
        if (s.cpu != null) { U.spark('g-cpu', s.cpu, 100, c); $('v-cpu').textContent = s.cpu.toFixed(0) + '%'; }
        if (s.mem) { U.spark('g-mem', s.mem.pct, 100, w); $('v-mem').textContent = (s.mem.used / 2 ** 30).toFixed(1) + ' GB'; }
        if (s.disk && s.disk.mbs != null) { U.spark('g-disk', s.disk.mbs, 0, w); $('v-disk').textContent = s.disk.mbs.toFixed(1) + ' MB/s'; }
        if (s.net && s.net.rx != null) {
          U.spark('g-rx', s.net.rx, 0, c); $('v-rx').textContent = U.fmtB(s.net.rx);
          U.spark('g-tx', s.net.tx, 0, `rgb(${ctx.rgb('b')})`); $('v-tx').textContent = U.fmtB(s.net.tx);
        }
        const cpu = s.cpu || 0, busy = cpu >= 70;
        m.el.classList.toggle('busy', busy);
        m.meta.innerHTML = `<span class="dot"></span>${busy ? 'HIGH LOAD' : cpu >= 45 ? 'BUSY' : cpu >= 15 ? 'ACTIVE' : 'IDLE'}`;
      },
    },
  });
})();
