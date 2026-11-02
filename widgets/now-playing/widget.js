/* Now Playing (prototype .stage): cover (two crossfading images) + eyebrow / title / artist / album /
   progress. Visibility: off -> on glides in from the left; on -> fade dissolves over ~80 s, then off.
   Resuming mid-fade switches straight back to .on, so the transition recovers from wherever it is.
   Artwork arrives as a data: URL from the host (frames cannot fetch); the host derives the theme
   palette from it (theme.accent: auto), which colours the source label. */
(() => {
  let np = null, curKey = null, vis = 'off', fadeTimer = null, el = {};
  const SRC = { music: 'APPLE MUSIC', spotify: 'SPOTIFY', demo: 'DEMO' };
  function setStage(on) {
    const st = el.stage, w = el.wrap;
    if (on) {
      if (vis === 'on') return;
      clearTimeout(fadeTimer);
      if (vis === 'off') void st.offsetWidth;          // commit the .off position before gliding in
      st.classList.remove('off', 'fade'); w.classList.remove('fade');
      st.classList.add('on'); w.classList.add('on'); vis = 'on';
    } else if (vis === 'on') {
      st.classList.remove('on'); w.classList.remove('on');
      st.classList.add('fade'); w.classList.add('fade'); vis = 'fade';
      fadeTimer = setTimeout(() => { st.classList.remove('fade'); w.classList.remove('fade'); st.classList.add('off'); vis = 'off'; }, 82000);
    }
  }
  function showArt(url) {
    const cur = el.imgs.find(i => i.classList.contains('show')), nxt = el.imgs.find(i => i !== cur);
    if (url) { nxt.src = url; nxt.classList.add('show'); }
    if (cur) cur.classList.remove('show');
  }
  function setText() { el.title.textContent = np.title || ''; el.artist.textContent = np.artist || ''; el.album.textContent = np.album || ''; }
  function tick() {
    if (!np || !(np.duration > 0)) return;
    const pos = np.position + (np.state === 'playing' ? (Date.now() - np.recv) / 1000 : 0);
    el.prog.style.width = Math.min(100, pos / np.duration * 100) + '%';
  }
  Orbit.widget({
    mount(ctx) {
      const s = ctx.settings;
      ctx.root.innerHTML = `<div class="wrap"><div class="stage off">
        <div class="cover"><img alt=""><img alt=""></div>
        <div class="meta"><div class="eb"><span class="state">NOW PLAYING</span><span class="sep"> · </span><span class="src"></span></div>
          <div class="title"></div><div class="artist"></div><div class="album"></div><div class="bar"><i></i></div></div></div></div>`;
      for (const k of ['wrap', 'stage', 'cover', 'meta', 'state', 'sep', 'src', 'title', 'artist', 'album', 'bar']) el[k] = ctx.root.querySelector('.' + k);
      el.imgs = [...el.cover.querySelectorAll('img')]; el.prog = el.bar.querySelector('i');
      ctx.root.style.setProperty('--mw', s.max_width);
      el.album.hidden = !s.show_album; el.bar.hidden = !s.show_progress; el.src.hidden = el.sep.hidden = !s.show_source;
      setInterval(tick, 500);
    },
    on: {
      nowPlaying(d) {
        np = Object.assign({}, d, { recv: Date.now() });
        const on = d.state === 'playing' || d.state === 'paused', fresh = vis === 'off';
        setStage(on);
        if (!on) return;
        el.state.textContent = d.state === 'paused' ? 'PAUSED' : 'NOW PLAYING';
        el.src.textContent = SRC[d.source] || String(d.source || '').toUpperCase() || 'APPLE MUSIC';
        if (d.key !== curKey) {
          curKey = d.key;
          if (fresh || curKey == null) setText();
          else {   // track change while visible: text dips out and back, artwork crossfades
            const a = el.meta.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-in', fill: 'forwards' });
            a.onfinish = () => { setText(); a.cancel(); el.meta.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, easing: 'ease-out' }); };
          }
          el.artKey = null;
          if (!d.hasArt) showArt(null);
        }
        // the host fetches the artwork after the metadata: show it as soon as its data: URL arrives
        if (d.artwork && d.artwork.startsWith('data:image/') && d.artwork !== el.artKey) { el.artKey = d.artwork; showArt(d.artwork); }
        tick();
      },
    },
  });
})();
