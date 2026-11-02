/* LAUNCHES: next rocket launch with a T− countdown, then the following few.
   Ported from the prototype wallpaper's "launches" module. Hidden when nothing is scheduled. */
(() => {
  'use strict';
  const ST = { Go: 'GO', TBC: '未確定', TBD: '未定', Hold: '待機', Success: '成功', 'In Flight': '飛行中' };
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const U = Orbit.ui, esc = U.esc, dur = U.dur, L = C.signals.launches, now = Date.now();
    const up = L && Array.isArray(L.items) ? L.items.filter(x => x && x.net && +new Date(x.net) > now - 3600e3) : [];
    if (!up.length) { lastKey = ''; C.visible(false); return; }
    const key = L.at + '|' + Math.floor(now / 60000); if (key === lastKey) return; lastKey = key;
    const split = x => { const [r, ...mm] = String(x.name || '').split(' | '); return { rocket: r, mission: mm.join(' | ') || r }; };
    const nx = up[0], a = split(nx), t = +new Date(nx.net) - now, place = (nx.location || '').split(',').slice(-1)[0].trim();
    const hm = d => new Date(d).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    let h = `<div class="nx"><b>${esc(a.mission)}</b><div class="sub">${hm(nx.net)} · ${esc(a.rocket)}${nx.provider ? ' · ' + esc(nx.provider) : ''}${place ? ' · ' + esc(place) : ''}</div>
      <div class="tminus"><small>${t > 0 ? 'T−' : 'T+'}</small>${t > 0 ? dur(t) : dur(-t)}</div></div>`;
    h += up.slice(1, 1 + C.settings.more).map(x => { const q = split(x); return `<div class="cd"><span class="n">${esc(q.rocket.replace(/ Block 5$/, ''))}<small>${esc(q.mission)}</small></span><span class="t" style="opacity:.6">${hm(x.net)}</span></div>`; }).join('');
    m.body.innerHTML = `<div class="lch">${h}</div>`;
    m.meta.textContent = ST[nx.status] || nx.status || '';
    C.visible(true);
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'LAUNCHES', 'm-launches'); render(); },
    on: { launches() { render(); }, time() { render(); } },
  });
})();
