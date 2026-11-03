/* CLOUD SYNC: local footprint of File Provider folders (OneDrive etc.). Only downloaded files take space on
   the Mac; online-only placeholders count 0. Turns the warning colour above providers.cloud.warn_gb. */
(() => {
  'use strict';
  const { meter, esc, agoTxt } = Orbit.ui;
  const gb = b => b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(b >= 10 * 2 ** 30 ? 0 : 1)}<small>GB</small>` : `${Math.round(b / 2 ** 20)}<small>MB</small>`;
  let m = null;
  Orbit.widget({
    mount(ctx) { m = Orbit.module(ctx, ctx.settings.title, 'm-cloud'); ctx.visible(false); },
    on: {
      cloud(c, ctx) {
        const fs = (c && c.folders) || [];
        if (!fs.length) { ctx.visible(false); return; }
        const warn = c.warn_bytes || 5 * 2 ** 30, cc = `rgb(${ctx.rgb('c')})`;
        const short = n => n.split(' · ')[0].toUpperCase();   // 'OneDrive · Account' -> ONEDRIVE
        m.body.innerHTML = fs.map(f => {
          const over = f.used > warn;
          return `<div class="cl ${over ? 'warn' : ''}"><div class="kv"><span class="k">${esc(short(f.name))}</span>` +
            `<span class="v">${gb(f.used)}<small>${f.files.toLocaleString()} / ${f.total_files.toLocaleString()} 件 DL済${f.partial ? ' · 集計中' : ''}</small></span></div>` +
            meter(Math.min(100, f.used / warn * 100), over ? '#ffb37a' : cc) + '</div>';
        }).join('');
        m.meta.textContent = c.at ? agoTxt(c.at) : '';
        ctx.visible(true);
      },
    },
  });
})();
