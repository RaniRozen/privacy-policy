(() => {
  const $ = (s) => document.querySelector(s);
  const form = $('#rsvp');
  const err = $('#err');
  let attending = null;
  let extra = 0;

  // תמונה שלא נטענה (למשל הוסרה) – מוסרים אותה כדי שלא תוצג תמונה שבורה
  document.querySelectorAll('.pol img').forEach((img) => {
    const drop = () => img.closest('.pol')?.remove();
    img.addEventListener('error', drop);
    if (img.complete && img.naturalWidth === 0) drop();
  });

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

  const show = (id) => {
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
    // המסך מציג את הסך הכל (כולל המוזמן); בשרת נשמר מספר המלווים (סך הכל פחות 1)
    $('#extra').textContent = extra + 1;
    $('#total').textContent = extra === 0 ? 'מגיע/ה לבד' : `${extra + 1} אנשים`;
  };
  // מקסימום 9 אנשים בסך הכל, בלי הודעה
  $('#plus').addEventListener('click', () => { extra = Math.min(8, extra + 1); render(); });
  $('#minus').addEventListener('click', () => { extra = Math.max(0, extra - 1); render(); });
  render();

  // Enter / "סיום" במקלדת סוגר את המקלדת בלבד. לחיצה מחוץ לשדה סוגרת אותה גם כן.
  form.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); i.blur(); }
  }));
  document.addEventListener('touchstart', (e) => {
    const el = document.activeElement;
    // לא סוגרים מקלדת כשלוחצים על כפתור/קישור: סגירה באמצע לחיצה מזיזה את הפריסה והכפתור היה מפספס
    if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && !e.target.closest('input, textarea, button, a, label, select')) el.blur();
  }, { passive: true });

  // ---- האורות למעלה דוהים בהדרגה ככל שגוללים, כדי שלא יסתירו את הטקסט ----
  const lights = document.querySelector('.lights');
  if (lights) {
    let ticking = false;
    const FADE_DISTANCE = 260; // אחרי כמה פיקסלים גלילה האורות נעלמים לגמרי
    const update = () => {
      const o = Math.max(0, Math.min(1, 1 - window.scrollY / FADE_DISTANCE));
      lights.style.opacity = o.toFixed(2);
      lights.style.visibility = o === 0 ? 'hidden' : 'visible';
      ticking = false;
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // ---- מקלדת נפתחת: הדף זז כך שהשדה תמיד נראה מעל המקלדת ----
  const vv = window.visualViewport;
  const isField = (el) => el && /^(INPUT|TEXTAREA)$/.test(el.tagName);
  let settleTimer = null;

  // גלילה מינימלית, פעם אחת, אחרי שהמקלדת התייצבה: רק אם השדה מוסתר או קרוב מדי לקצה
  const reveal = () => {
    const el = document.activeElement;
    if (!isField(el)) return;
    const r = el.getBoundingClientRect();
    const top = (vv ? vv.offsetTop : 0) + 16;
    const bottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 24;
    let delta = 0;
    if (r.bottom > bottom) delta = r.bottom - bottom;
    else if (r.top < top) delta = r.top - top;
    if (Math.abs(delta) >= 4) window.scrollBy({ top: delta, behavior: 'smooth' });
  };
  const scheduleReveal = (ms) => { clearTimeout(settleTimer); settleTimer = setTimeout(reveal, ms); };

  const keyboardSync = () => {
    // גובה המקלדת = ההפרש בין גובה החלון לגובה האזור הנראה; אם הדפדפן לא דיווח – מניחים גובה סביר
    let kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height)) : 0;
    if (isField(document.activeElement) && kb < 100) kb = 340;
    if (!isField(document.activeElement) && kb < 100) kb = 0;
    document.documentElement.style.setProperty('--kb', kb + 'px');
  };
  // כל שינוי בגובה האזור הגלוי מאפס את ההמתנה, כך שהגלילה קורית רק כשהמקלדת סיימה להיפתח
  if (vv) vv.addEventListener('resize', () => { keyboardSync(); scheduleReveal(280); });
  document.addEventListener('focusin', (e) => { if (isField(e.target)) { keyboardSync(); scheduleReveal(450); } });
  document.addEventListener('focusout', () => { clearTimeout(settleTimer); setTimeout(keyboardSync, 150); });

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
    show('done');
  }

  const remember = (rec) => store.set('raniRsvp', JSON.stringify(rec));
  let current = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.step.on .send');
    const btnText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'שולח...';
    err.textContent = '';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 70000); // האתר החינמי לפעמים מתעורר לאט
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
        signal: ctl.signal,
      });
      let data = {};
      try { data = await res.json(); } catch { /* תשובה לא תקינה */ }
      if (!res.ok) throw new Error(data.error || 'משהו השתבש, נסו שוב');
      current = rec;
      remember(rec);
      showDone(rec, true);
    } catch (ex) {
      // הודעות מהשרת הן בעברית; כל שגיאה אחרת (חיבור, זמן קצוב) מוצגת בנוסח ידידותי
      err.textContent = /[\u0590-\u05ff]/.test(ex.message) ? ex.message : 'אין חיבור כרגע, נסו שוב בעוד רגע';
    } finally {
      clearTimeout(timer);
      btn.disabled = false;
      btn.textContent = btnText;
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
        show('1');
      }
    })
    .catch(() => { /* השרת לא זמין – נשארים עם מה ששמור בטלפון */ });
})();
