(() => {
  const $ = (s) => document.querySelector(s);
  let all = [];
  let filter = 'all';

  const api = async (url, opts) => {
    const res = await fetch(url, opts);
    if (res.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('unauthorized'); }
    return res;
  };
  const showLogin = () => { $('#app').hidden = true; $('#login').hidden = false; $('#pw').focus(); };
  const showApp = () => { $('#login').hidden = true; $('#app').hidden = false; };

  async function load() {
    try {
      const res = await api('/api/admin/list');
      all = (await res.json()).rsvps;
      showApp();
      render();
    } catch { /* showLogin נקרא כבר */ }
  }

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    Object.assign(n, props);
    n.append(...kids);
    return n;
  }

  function render() {
    const yes = all.filter((r) => r.attending);
    const no = all.filter((r) => !r.attending);
    const people = yes.reduce((s, r) => s + 1 + r.extra, 0);
    const stat = (cls, n, label) => el('div', { className: 'stat ' + cls }, el('b', { textContent: n }), el('span', { textContent: label }));
    $('#stats').replaceChildren(
      stat('b', people, 'סה"כ אנשים מגיעים'),
      stat('g', yes.length, 'משפחות/אנשים שאישרו'),
      stat('y', yes.reduce((s, r) => s + r.extra, 0), 'מלווים'),
      stat('r', no.length, 'לא מגיעים'),
      stat('', all.length, 'סה"כ תשובות'),
    );

    const q = $('#q').value.trim().toLowerCase();
    const list = all
      .filter((r) => (filter === 'all' || (filter === 'yes') === r.attending) && r.name.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    $('#empty').hidden = list.length > 0;
    $('#rows').replaceChildren(...list.map((r) => {
      const del = el('button', { className: 'del', title: 'מחיקה', textContent: '🗑️' });
      del.addEventListener('click', async () => {
        if (!confirm('למחוק את "' + r.name + '"?')) return;
        await api('/api/admin/rsvp/' + encodeURIComponent(r.id), { method: 'DELETE' });
        load();
      });
      const nameCell = el('td', {}, el('b', { textContent: r.name }));
      if (r.note) nameCell.append(el('div', { className: 'note', textContent: '💬 ' + r.note }));
      return el('tr', {},
        nameCell,
        el('td', {}, el('span', { className: 'tag ' + (r.attending ? 'yes' : 'no'), textContent: r.attending ? 'מגיע/ה' : 'לא מגיע/ה' })),
        el('td', { textContent: r.attending ? (r.extra ? `${1 + r.extra} (+${r.extra})` : '1') : '–' }),
        el('td', { className: 'hide-s note', textContent: new Date(r.updatedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) }),
        el('td', {}, del),
      );
    }));
  }

  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#lerr').textContent = '';
    const res = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#pw').value }),
    });
    if (res.ok) { $('#pw').value = ''; load(); }
    else $('#lerr').textContent = (await res.json()).error || 'שגיאה';
  });
  $('#logout').addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST' }); all = []; showLogin(); });
  $('#refresh').addEventListener('click', load);
  $('#q').addEventListener('input', render);
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    filter = c.dataset.f;
    document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
    render();
  }));

  load();
  setInterval(() => { if (!$('#app').hidden) load(); }, 30000);
})();
