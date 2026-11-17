(() => {
  const PLACE = 'בית הכנסת נווה שכטר, שלוש 42, תל אביב';
  const Q = encodeURIComponent(PLACE);
  const TITLE = 'בר המצווה של רני 🎉';
  const DETAILS = '10:00 קבלת פנים | 10:30 טקס העלייה לתורה | 11:30 ארוחת בראנץ | 12:30 טקס, ברכות והפתעות';
  const START = '20261203T080000Z'; // 10:00 שעון ישראל
  const END = '20261203T140000Z';   // 16:00 שעון ישראל
  const e = encodeURIComponent;

  const SHEETS = {
    nav: {
      title: 'איך לנווט?',
      opts: [
        { icon: '🚗', color: '#33ccff', label: 'Waze', href: `https://waze.com/ul?q=${Q}&navigate=yes` },
        { icon: '🗺️', color: '#34a853', label: 'Google Maps', href: `https://www.google.com/maps/search/?api=1&query=${Q}` },
        { icon: '🍎', color: '#e8e8ed', label: 'Apple Maps', href: `https://maps.apple.com/?q=${Q}` },
      ],
    },
    cal: {
      title: 'לאיזה יומן להוסיף?',
      opts: [
        { icon: '📅', color: '#4285f4', label: 'Google Calendar', href: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${e(TITLE)}&dates=${START}/${END}&location=${e(PLACE)}&details=${e(DETAILS)}` },
        { icon: '🍎', color: '#e8e8ed', label: 'Apple Calendar (אייפון / מק)', href: 'rani-bar-mitzvah.ics', same: true },
        { icon: '📧', color: '#0078d4', label: 'Outlook', href: `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${e(TITLE)}&startdt=2026-12-03T08:00:00Z&enddt=2026-12-03T14:00:00Z&location=${e(PLACE)}&body=${e(DETAILS)}` },
        { icon: '📥', color: '#ffd23f', label: 'קובץ ליומן אחר (ICS)', href: 'rani-bar-mitzvah.ics', same: true },
      ],
    },
  };

  const bg = document.getElementById('sheetBg');
  const box = bg.querySelector('.sheet');
  const opts = document.getElementById('sheetOpts');
  let lastFocus = null;

  function open(kind) {
    const cfg = SHEETS[kind];
    document.getElementById('sheetTitle').textContent = cfg.title;
    opts.replaceChildren(...cfg.opts.map((o) => {
      const a = document.createElement('a');
      a.className = 'opt';
      a.href = o.href;
      if (!o.same) { a.target = '_blank'; a.rel = 'noopener'; }
      const i = document.createElement('span');
      i.className = 'oi'; i.style.background = o.color; i.textContent = o.icon;
      const t = document.createElement('span');
      t.textContent = o.label;
      a.append(i, t);
      a.addEventListener('click', () => setTimeout(close, 150));
      return a;
    }));
    lastFocus = document.activeElement;
    bg.hidden = false;
    requestAnimationFrame(() => bg.classList.add('show'));
    document.body.style.overflow = 'hidden';
    opts.querySelector('a').focus({ preventScroll: true });
  }
  function close() {
    bg.classList.remove('show');
    document.body.style.overflow = '';
    setTimeout(() => { bg.hidden = true; }, 200);
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => open(b.dataset.sheet)));
  document.getElementById('sheetClose').addEventListener('click', close);
  bg.addEventListener('click', (ev) => { if (!box.contains(ev.target)) close(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !bg.hidden) close(); });
})();
