/* OPS: GitHub, RFCs, Claude Code sessions, Claude weekly (ported from the prototype's OPS module). */
(() => {
  const { tile, kv, meter, esc, agoTxt } = Orbit.ui;
  let m = null;
  function render(ctx) {
    const S = ctx.signals, g = S.github, rf = (S.rfc || {}).pending || [], ses = (S.sessions || {}).local || [], t = [];
    const act = rf.filter(x => x.user_action).length;
    t.push(tile(g ? g.review : '–', 'REVIEW 依頼', g && g.review ? 'warn' : ''));
    t.push(tile(g ? g.failing : '–', 'CI 失敗', g && g.failing ? 'warn' : ''));
    t.push(tile(rf.length, `RFC 承認待ち${act ? ' · 作業要 ' + act : ''}`, rf.length ? 'warn' : ''));
    t.push(tile(ses.length, 'CLAUDE CODE'));
    let h = `<div class="tiles">${t.join('')}</div>`;
    if (rf.length) h += `<div class="foot">RFC ${rf.map(x => esc(x.id) + (x.user_action ? '*' : '')).join(' · ')}</div>`;
    if (ses.length) h += `<div class="foot">SESSIONS ${[...new Set(ses.map(x => esc(x.cwd)))].join(' · ')}</div>`;
    const wk = S.claudeUsage && (S.claudeUsage.rows || []).find(r => r.key === 'seven_day');
    if (wk) { const left = Math.round(100 - wk.pct), col = left < 15 ? '#ff5a6e' : left < 35 ? '#ffb84d' : `rgb(${ctx.rgb('c')})`;
      h += `<div class="cw">${kv('CLAUDE 週', `残 ${left}%`)}${meter(left, col)}${wk.resets ? `<div class="foot">リセット ${new Date(wk.resets).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div>` : ''}</div>`; }
    m.body.innerHTML = h;
    m.meta.textContent = g && g.at ? agoTxt(g.at) : '';
  }
  Orbit.widget({
    mount(ctx) { m = Orbit.module(ctx, 'OPS', 'm-ops'); render(ctx); },
    on: { github: (d, c) => render(c), rfc: (d, c) => render(c), sessions: (d, c) => render(c), claudeUsage: (d, c) => render(c) },
  });
})();
