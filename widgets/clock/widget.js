/* Clock: time + date, formatted with the theme locale (theme.locale / theme.hour12). */
Orbit.widget({
  mount(ctx) {
    ctx.root.innerHTML = '<div class="clock"></div><div class="date"></div>';
    ctx.root.style.setProperty('--size', ctx.settings.size);
    ctx.root.querySelector('.date').hidden = !ctx.settings.show_date;
  },
  on: {
    time(t, ctx) {
      const d = new Date(t.now);
      const opts = { hour: '2-digit', minute: '2-digit', hour12: ctx.hour12 };
      if (ctx.settings.seconds) opts.second = '2-digit';
      ctx.root.querySelector('.clock').textContent = d.toLocaleTimeString(ctx.locale, opts);
      ctx.root.querySelector('.date').textContent = d.toLocaleDateString(ctx.locale, { month: 'long', day: 'numeric', weekday: 'long' });
    },
  },
});
