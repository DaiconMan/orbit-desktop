/* NEWS: headlines from the news provider's RSS feed with their times.
   Ported from the prototype wallpaper's "news" module. Hidden while there are no items. */
(() => {
  'use strict';
  let m = null, C = null, lastKey = '';
  function render() {
    if (!m) return;
    const U = Orbit.ui, esc = U.esc, n = C.signals.news;
    if (!n || !Array.isArray(n.items) || !n.items.length) { lastKey = ''; C.visible(false); return; }
    const key = n.at + '|' + JSON.stringify(n.items.slice(0, 10)) + Math.floor(Date.now() / 60000); if (key === lastKey) return; lastKey = key;
    const items = n.items.slice(0, C.settings.count);
    m.body.innerHTML = `<div class="lst news">${items.map(x => `<div class="it"><span class="t">${esc(x.title)}</span><span class="a">${x.at ? new Date(x.at * 1000).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>`).join('')}</div>`;
    const src = C.settings.source_label;
    m.meta.textContent = (src ? src + ' · ' : '') + (n.at ? U.agoTxt(n.at) : '');
    C.visible(true);
  }
  Orbit.widget({
    mount(ctx) { C = ctx; m = Orbit.module(ctx, 'NEWS', 'm-news'); render(); },
    on: { news() { render(); }, time() { render(); } },
  });
})();
