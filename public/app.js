(() => {
  const $ = (s) => document.querySelector(s);
  const form = $('#rsvp');
  const err = $('#err');
  let attending = null;
  let extra = 0;

  // ---- זיהוי מכשיר (מזהה אקראי שנשמר בדפדפן) ----
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  let device = store.get('raniDevice');
  if (!device || !/^[a-zA-Z0-9-]{16,64}$/.test(device)) {
    device = (crypto.randomUUID && crypto.randomUUID()) || Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    store.set('raniDevice', device);
  }

  const show = (id, focus = true) => {
    form.querySelectorAll('.step').forEach((s) => s.classList.toggle('on', s.dataset.step === id));
    document.body.classList.toggle('registered', id === 'done'); // מי שכבר נרשם לא צריך לראות "אנא אשרו הגעה"
    err.textContent = '';
  };
  const name = () => $('#name').value.trim();
  const firstName = (n) => n.split(' ')[0];

  const goNext = () => {
    if (name().length < 2) { err.textContent = 'נא להזין את השם שלך'; return; }
    $('#hi').textContent = firstName(name());
    show('2');
  };
  form.querySelector('.next').addEventListener('click', goNext);

  form.querySelectorAll('.choice .btn').forEach((b) => b.addEventListener('click', () => {
    attending = b.dataset.v === 'yes';
    show(attending ? '3' : 'no');
  }));

  form.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => {
    const cur = b.closest('.step').dataset.step;
    show(cur === '2' ? '1' : '2');
  }));

  const render = () => {
    $('#extra').textContent = extra;
    $('#total').textContent = extra === 0 ? 'מגיע/ה לבד' : `סה"כ ${extra + 1} אנשים`;
  };
  $('#plus').addEventListener('click', () => { extra = Math.min(9, extra + 1); render(); });
  $('#minus').addEventListener('click', () => { extra = Math.max(0, extra - 1); render(); });
  render();

  // Enter / "סיום" במקלדת סוגר את המקלדת בלבד. לחיצה מחוץ לשדה סוגרת אותה גם כן.
  form.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); i.blur(); }
  }));
  document.addEventListener('touchstart', (e) => {
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && !e.target.closest('input, textarea')) el.blur();
  }, { passive: true });

  // ---- מקלדת נפתחת: הדף זז כך שהשדה תמיד נראה מעל המקלדת ----
  const vv = window.visualViewport;
  const isField = (el) => el && /^(INPUT|TEXTAREA)$/.test(el.tagName);
  const reveal = () => {
    const el = document.activeElement;
    if (isField(el)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const keyboardSync = () => {
    // גובה המקלדת = ההפרש בין גובה החלון לגובה האזור הנראה בפועל
    const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    document.documentElement.style.setProperty('--kb', kb + 'px');
    if (kb > 0) setTimeout(reveal, 60);
  };
  if (vv) vv.addEventListener('resize', keyboardSync);
  document.addEventListener('focusin', (e) => { if (isField(e.target)) { setTimeout(keyboardSync, 120); setTimeout(reveal, 400); } });
  document.addEventListener('focusout', () => setTimeout(keyboardSync, 150));

  // ---- מסך "כבר נרשמת" / "תודה" ----
  function showDone(rec, justSent) {
    const box = $('#thanks');
    box.replaceChildren();
    const big = document.createElement('span');
    big.className = 'big';
    const n = firstName(rec.name);
    big.textContent = justSent ? (rec.attending ? 'תודה ' + n + '!' : 'תודה שעדכנת ' + n) : 'היי ' + n + ', כבר נרשמת ✓';
    const line = rec.attending
      ? `מגיעים: ${rec.extra + 1} ${rec.extra === 0 ? 'אורח/ת' : 'אורחים'}. נתראה ב-03.12! 🎉`
      : 'סימנת שלא תוכלו להגיע. נשמח לחגוג איתך בהזדמנות אחרת 💛';
    box.append(big, line);
    $('#again').textContent = 'לשינוי התשובה';
    show('done', false);
  }

  const remember = (rec) => store.set('raniRsvp', JSON.stringify(rec));
  let current = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.step.on .send');
    btn.disabled = true;
    const rec = {
      name: name(),
      attending,
      extra: attending ? extra : 0,
      note: (attending ? $('#note') : $('#note2')).value.trim(),
    };
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rec, device }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      current = rec;
      remember(rec);
      showDone(rec, true);
    } catch (ex) {
      err.textContent = ex.message || 'משהו השתבש, נסו שוב';
    } finally {
      btn.disabled = false;
    }
  });

  // "לשינוי התשובה": ממלא מחדש את הטופס בתשובה הקודמת
  $('#again').addEventListener('click', () => {
    if (current) {
      $('#name').value = current.name;
      extra = current.extra || 0;
      $('#note').value = current.attending ? current.note : '';
      $('#note2').value = current.attending ? '' : current.note;
      render();
    }
    show('1');
  });

  // ---- בדיקה בעת טעינה: האם המכשיר הזה כבר נרשם? ----
  try { current = JSON.parse(store.get('raniRsvp')); } catch { current = null; }
  if (current && current.name) { attending = current.attending; showDone(current, false); } // מיידי, לפני תשובת השרת

  fetch('/api/rsvp/mine?device=' + encodeURIComponent(device))
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(({ rsvp }) => {
      if (rsvp) {
        current = rsvp; attending = rsvp.attending; remember(rsvp);
        if (!form.querySelector('.step.on[data-step="1"], .step.on[data-step="2"], .step.on[data-step="3"], .step.on[data-step="no"]') || !$('#name').value) showDone(rsvp, false);
      } else if (current) {
        // נמחק ע"י המנהל – מתחילים מחדש
        current = null; store.del('raniRsvp');
        show('1', false);
      }
    })
    .catch(() => { /* השרת לא זמין – נשארים עם מה ששמור בטלפון */ });
})();
