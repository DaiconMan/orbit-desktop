/* ALERTS: 緊急地震速報 (EEW) and 津波 banners (ported from the prototype's renderAlerts / tickAlerts).
   Place it full width at the top with dim: false. Nothing active -> visible(false), zero height.
   The red edge flash runs once per new (non-cancelled) EEW; inside the sandbox it can only glow along
   this frame's own edges. */
(() => {
  const { esc, SCALE } = Orbit.ui;
  let ae, at, edge, secEl, labEl, eew = null, edgeFor = '';
  function renderAlerts(a, ctx) {
    a = a || {};
    const e = a.eew, t = a.tsunami;
    eew = e || null;
    if (e) {
      const areas = e.areas || [], strong = areas.filter(x => x.kind !== '19');
      const scaleTxt = x => x.from ? `震度${SCALE[x.from] || '?'}${x.to === 99 ? '以上' : x.to && x.to !== x.from ? '〜' + (SCALE[x.to] || '') : ''}` : '';
      const mx = e.maxscale ? `予想最大 震度${SCALE[e.maxscale] || '?'}${areas.some(x => x.to === 99) ? '以上' : ''}` : '';
      const mu = e.music || {};
      const note = mu.eligible ? (mu.dry ? `テスト: 音楽停止の条件に一致（${mu.paused && mu.paused.length ? mu.paused.join('・') + ' 再生中' : '再生中なし'}）· 実際には停止していません`
        : mu.paused && mu.paused.length ? `音楽を停止しました（${mu.paused.join('・')}）` : '') : '';
      ae.classList.toggle('cancel', !!e.cancelled);
      ae.innerHTML = `<div class="top"><span>EEW · EARTHQUAKE EARLY WARNING</span>${e.serial ? `<span>第${esc(e.serial)}報</span>` : ''}${e.test ? '<span class="tag">TEST</span>' : ''}${e.condition ? `<span>${esc(e.condition)}</span>` : ''}</div>
        <div class="main"><h1>${e.cancelled ? '緊急地震速報 取消' : '緊急地震速報'}</h1>
          <div class="epi">${esc(e.place || '震源 調査中')}${e.mag ? `<small>M${(+e.mag).toFixed(1)}</small>` : ''}${e.depth != null ? `<small>深さ ${esc(e.depth)}km</small>` : ''}${mx ? `<small>${mx}</small>` : ''}</div>
          <div class="el"><b class="sec">–</b><span class="seclab">発生から 秒</span></div></div>
        ${e.cancelled ? '<div class="areas">この緊急地震速報は取り消されました</div>' : `<div class="areas"><em>強い揺れに警戒</em>${(strong.length ? strong : areas).slice(0, 18).map(x => `<span>${esc(x.name)}${x.from ? ` <small style="opacity:.55">${scaleTxt(x)}</small>` : ''}</span>`).join('')}${areas.length > 18 ? `<span style="opacity:.5">ほか${areas.length - 18}地域</span>` : ''}</div>`}
        ${note ? `<div class="note">${esc(note)}</div>` : ''}`;
      secEl = ae.querySelector('.sec'); labEl = ae.querySelector('.seclab');
      if (!ae.classList.contains('on')) ae.classList.add('on');
      if (edgeFor !== String(e.id) && !e.cancelled) { edgeFor = String(e.id); edge.classList.remove('go'); void edge.offsetWidth; edge.classList.add('go'); }
    } else { ae.classList.remove('on'); ae.textContent = ''; secEl = labEl = null; }
    if (t && t.areas && t.areas.length) {
      const G = { MajorWarning: '大津波警報', Warning: '津波警報', Watch: '津波注意報', Unknown: '津波予報' }, order = ['MajorWarning', 'Warning', 'Watch', 'Unknown'];
      const top = order.find(g => t.areas.some(x => x.grade === g)) || 'Unknown';
      at.classList.toggle('major', top === 'MajorWarning');
      at.innerHTML = `<div class="top"><span>TSUNAMI · 津波情報</span>${t.test ? '<span class="tag">TEST</span>' : ''}</div>
        <div class="main"><h1>${G[top]}</h1><div class="epi">海岸から離れ、高い所へ</div></div>
        <div class="areas">${order.filter(g => t.areas.some(x => x.grade === g)).map(g => `<em>${G[g]}</em>${t.areas.filter(x => x.grade === g).slice(0, 14).map(x => `<span>${esc(x.name)}${x.height ? ` <small style="opacity:.55">${esc(x.height)}</small>` : ''}${x.immediate ? ' <small class="warn">直ちに来襲</small>' : ''}</span>`).join('')}`).join('')}</div>`;
      if (!at.classList.contains('on')) at.classList.add('on');
    } else { at.classList.remove('on'); at.textContent = ''; }
    tickAlerts();
    ctx.visible(!!(e || (t && t.areas && t.areas.length)));
  }
  function tickAlerts() {
    const e = eew; if (!e || !secEl) return;
    const nowS = Date.now() / 1000, useO = e.origin && e.origin <= nowS + 2 && nowS - e.origin < 900;   // origin time only if plausible
    const sec = Math.max(0, Math.round(nowS - (useO ? e.origin : e.recv)));
    secEl.textContent = sec < 600 ? sec : Math.round(sec / 60) + '分';
    labEl.textContent = (useO ? '発生から' : '受信から') + (sec < 600 ? ' 秒' : '');
  }
  Orbit.widget({
    mount(ctx) {
      ctx.root.innerHTML = '<div class="alerts"><div class="al eew"></div><div class="al tsu"></div><div class="edge"></div></div>';
      ae = ctx.root.querySelector('.al.eew'); at = ctx.root.querySelector('.al.tsu'); edge = ctx.root.querySelector('.edge');
      ctx.visible(false);
      setInterval(tickAlerts, 1000);
    },
    on: { alerts: renderAlerts },
  });
})();
