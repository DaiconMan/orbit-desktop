/* Now Playing: artwork + metadata + progress. Artwork arrives as a data: URL from the host
   (frames cannot fetch). Glow colours follow the theme palette, which the host derives from
   the artwork when theme.accent is "auto". */
(() => {
  let np = null, curKey = null, el = {};
  const L = { en: { playing: 'NOW PLAYING', paused: 'PAUSED' }, ja: { playing: 'NOW PLAYING', paused: 'PAUSED' } };
  const SRC = { music: 'APPLE MUSIC', spotify: 'SPOTIFY', demo: 'DEMO' };
  function tick() {
    if (!np || !(np.duration > 0) || !el.prog) return;
    const pos = np.position + (np.state === 'playing' ? (Date.now() - np.recv) / 1000 : 0);
    el.prog.style.width = Math.min(100, pos / np.duration * 100) + '%';
  }
  Orbit.widget({
    mount(ctx) {
      const s = ctx.settings;
      ctx.root.innerHTML = `<div class="stage"><img class="cover" alt="" hidden><div class="meta" style="max-width:calc(${s.max_width} * var(--vw))">
        <div class="label"><span class="state"></span><span class="src"></span></div>
        <div class="title"></div><div class="artist"></div><div class="album"></div>
        <div class="bar"><i></i></div></div></div>`;
      for (const k of ['stage', 'cover', 'state', 'src', 'title', 'artist', 'album', 'bar']) el[k] = ctx.root.querySelector('.' + k);
      el.prog = el.bar.querySelector('i');
      el.album.hidden = !s.show_album; el.bar.hidden = !s.show_progress; el.src.hidden = !s.show_source;
      setInterval(tick, 500);
    },
    on: {
      nowPlaying(d, ctx) {
        np = Object.assign({}, d, { recv: Date.now() });
        const on = d.state === 'playing' || d.state === 'paused';
        el.stage.classList.toggle('on', on);
        if (!on) { curKey = null; return; }
        const l = L[ctx.lang] || L.en;
        el.state.textContent = d.state === 'paused' ? l.paused : l.playing;
        el.src.textContent = ' · ' + (SRC[d.source] || String(d.source || '').toUpperCase());
        if (d.key !== curKey) {
          curKey = d.key;
          el.title.textContent = d.title || ''; el.artist.textContent = d.artist || ''; el.album.textContent = d.album || '';
        }
        // only data: images can load under the frame CSP
        if (d.artwork && d.artwork.startsWith('data:image/')) { if (el.cover.src !== d.artwork) el.cover.src = d.artwork; el.cover.hidden = false; }
        else if (!d.artwork) el.cover.hidden = !el.cover.src;
        tick();
      },
    },
  });
})();
