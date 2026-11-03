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
  // playback buttons: each asks the host app to run a `music` action (declared in widget.yaml `actions:`)
  const ICON = {
    previous: '<path d="M6 5v14M18 6l-9 6 9 6z"/>', next: '<path d="M18 5v14M6 6l9 6-9 6z"/>',
    play: '<path d="M8 5l11 7-11 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
    shuffle: '<path d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    repeat: '<path d="M5 12V9a3 3 0 0 1 3-3h11M16 3l3 3-3 3M19 12v3a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>',
  };
  const svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  function buildControls(ctx) {
    const s = ctx.settings, lists = (s.playlists || []).filter(Boolean).slice(0, 3);
    const btn = (v, label, html) => `<button type="button" data-v="${ctx.esc(v)}" aria-label="${ctx.esc(label)}">${html}</button>`;
    el.ctl.innerHTML = s.controls ? `<div class="row">${btn('previous', '前の曲', svg(ICON.previous))}${btn('playpause', '再生 / 一時停止', `<span class="pp">${svg(ICON.pause)}</span>`)}${btn('next', '次の曲', svg(ICON.next))}<i class="gap"></i>${btn('shuffle', 'シャッフル', svg(ICON.shuffle))}${btn('repeat', 'リピート', svg(ICON.repeat))}</div>` : '';
    const pl = lists.map(n => btn('playlist:' + n, n, `<span>${ctx.esc(n.startsWith('spotify:') ? 'Spotify' : n)}</span>`)).join('');
    if (pl) el.ctl.insertAdjacentHTML('beforeend', `<div class="pls">${pl}</div>`);
    el.idle.innerHTML = pl ? `<span class="lbl">♪</span>${pl}` : '';
    el.ctl.hidden = !s.controls && !pl;
    for (const b of ctx.root.querySelectorAll('button[data-v]')) b.onclick = () => { ctx.action('music', b.dataset.v); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 300); };
  }

  Orbit.widget({
    mount(ctx) {
      const s = ctx.settings;
      ctx.root.innerHTML = `<div class="wrap"><div class="stage off">
        <div class="cover"><img alt=""><img alt=""></div>
        <div class="meta"><div class="eb"><span class="state">NOW PLAYING</span><span class="sep"> · </span><span class="src"></span></div>
          <div class="title"></div><div class="artist"></div><div class="album"></div><div class="bar"><i></i></div>
          <div class="ctl"></div></div></div><div class="idle"></div></div>`;
      for (const k of ['wrap', 'stage', 'cover', 'meta', 'state', 'sep', 'src', 'title', 'artist', 'album', 'bar', 'ctl', 'idle']) el[k] = ctx.root.querySelector('.' + k);
      buildControls(ctx);
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
        el.idle.classList.toggle('on', !on && !!el.idle.innerHTML);
        if (!on) return;
        el.state.textContent = d.state === 'paused' ? 'PAUSED' : 'NOW PLAYING';
        const pp = el.ctl.querySelector('.pp'); if (pp) pp.innerHTML = svg(d.state === 'playing' ? ICON.pause : ICON.play);
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
