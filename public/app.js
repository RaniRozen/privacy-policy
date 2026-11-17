(() => {
  const $ = (s) => document.querySelector(s);
  const form = $('#rsvp');
  const err = $('#err');
  let attending = null;
  let extra = 0;

  const show = (id) => {
    form.querySelectorAll('.step').forEach((s) => s.classList.toggle('on', s.dataset.step === id));
    err.textContent = '';
    const f = form.querySelector('.step.on input, .step.on .btn');
    if (f && id !== 'done') f.focus({ preventScroll: true });
  };
  const name = () => $('#name').value.trim();

  const goNext = () => {
    if (name().length < 2) { err.textContent = 'נא להזין את השם שלך'; return; }
    $('#hi').textContent = name().split(' ')[0];
    show('2');
  };
  form.querySelector('.next').addEventListener('click', goNext);
  $('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goNext(); } });

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
  $('#plus').addEventListener('click', () => { extra = Math.min(20, extra + 1); render(); });
  $('#minus').addEventListener('click', () => { extra = Math.max(0, extra - 1); render(); });
  render();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.step.on .send');
    btn.disabled = true;
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name(),
          attending,
          extra: attending ? extra : 0,
          note: (attending ? $('#note') : $('#note2')).value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      const first = name().split(' ')[0];
      $('#thanks').innerHTML = '';
      const big = document.createElement('span');
      big.className = 'big';
      big.textContent = attending ? 'תודה ' + first + '!' : 'תודה שעדכנת ' + first;
      $('#thanks').append(big, attending
        ? `רשמנו ${extra + 1} ${extra === 0 ? 'אורח/ת' : 'אורחים'}. נתראה ב-03.12! 🎉`
        : 'נשמח לחגוג איתך בהזדמנות אחרת 💛');
      show('done');
    } catch (ex) {
      err.textContent = ex.message || 'משהו השתבש, נסו שוב';
    } finally {
      btn.disabled = false;
    }
  });

  $('#again').addEventListener('click', () => { extra = 0; render(); show('1'); });
})();
