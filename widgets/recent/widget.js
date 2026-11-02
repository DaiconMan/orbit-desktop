/* RECENT TRACKS: the last tracks seen by the now-playing provider; the current one is marked 再生中 / 一時停止.
   Ported from the prototype wallpaper's "recent" module. Hidden while the history is empty. */
(() => {
  'use strict';
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const U = Orbit.ui, esc = U.esc, rec = C.signals.recent, np = C.signals.nowPlaying;
    const r = ((rec && Array.isArray(rec.items)) ? rec.items : []).slice(0, C.settings.count);
    if (!r.length) { lastKey = ''; C.visible(false); return; }
    const playing = np && (np.state === 'playing' || np.state === 'paused') ? np.title : null;
    const key = r.map(x => x.title + x.at).join() + playing + (np && np.state) + Math.floor(Date.now() / 60000); if (key === lastKey) return; lastKey = key;
    m.body.innerHTML = `<div class="lst">${r.map((x, i) => { const cur = i === 0 && playing != null && x.title === playing;
      return `<div class="it ${cur ? 'cur' : ''}"><span class="t">${esc(x.title)}<small>${esc(x.artist)}</small></span><span class="a">${cur ? (np.state === 'playing' ? '再生中' : '一時停止') : (x.at ? U.agoTxt(x.at) : '')}</span></div>`; }).join('')}</div>`;
    C.visible(true);
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'RECENT TRACKS', 'm-recent'); render(); },
    on: { recent() { render(); }, nowPlaying() { render(); }, time() { render(); } },
  });
})();
