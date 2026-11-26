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
        if (!confirm('להסיר את "' + r.name + '" מהרשימה?\n(עותק נשמר בסל האשפה ואפשר לשחזר)')) return;
        try {
          const res = await api('/api/admin/rsvp/' + encodeURIComponent(r.id), { method: 'DELETE' });
          if (!res.ok && res.status !== 404) alert((await res.json().catch(() => ({}))).error || 'המחיקה לא הצליחה, נסו שוב');
        } catch { return; /* לא מחובר – מסך הכניסה כבר מוצג */ }
        load();
      });
      const edit = el('button', { className: 'edit', title: 'עריכה', textContent: '✏️' });
      edit.addEventListener('click', () => openEdit(r));
      const nameCell = el('td', {}, el('b', { textContent: r.name }));
      if (r.note) nameCell.append(el('div', { className: 'note', textContent: '💬 ' + r.note }));
      return el('tr', {},
        nameCell,
        el('td', {}, el('span', { className: 'tag ' + (r.attending ? 'yes' : 'no'), textContent: r.attending ? 'מגיע/ה' : 'לא מגיע/ה' })),
        el('td', { dir: 'ltr', style: 'text-align:right', textContent: r.attending ? (r.extra ? `${1 + r.extra} (+${r.extra})` : '1') : '–' }),
        el('td', { className: 'hide-s note', textContent: new Date(r.updatedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) }),
        el('td', { className: 'acts' }, edit, del),
      );
    }));
  }

  // ---------- חלון עריכה ----------
  let editing = null; // { id, attending, total }
  const eBg = $('#editBg');
  const syncEdit = () => {
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'yes') === editing.attending));
    $('#eCountWrap').style.display = editing.attending ? '' : 'none';
    $('#eCount').textContent = editing.total;
  };
  function openEdit(r) {
    editing = { id: r.id, attending: r.attending, total: Math.max(1, Math.min(10, 1 + (r.extra || 0))) };
    $('#eName').value = r.name;
    $('#eErr').textContent = '';
    syncEdit();
    eBg.hidden = false;
  }
  const closeEdit = () => { eBg.hidden = true; editing = null; };
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { editing.attending = b.dataset.v === 'yes'; syncEdit(); }));
  $('#ePlus').addEventListener('click', () => { editing.total = Math.min(10, editing.total + 1); syncEdit(); });
  $('#eMinus').addEventListener('click', () => { editing.total = Math.max(1, editing.total - 1); syncEdit(); });
  $('#eCancel').addEventListener('click', closeEdit);
  eBg.addEventListener('click', (ev) => { if (ev.target === eBg) closeEdit(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !eBg.hidden) closeEdit(); });
  $('#eName').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } });
  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#eName').value.trim();
    if (name.length < 2) { $('#eErr').textContent = 'נא להזין שם'; return; }
    const res = await api('/api/admin/rsvp/' + encodeURIComponent(editing.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, attending: editing.attending, extra: editing.attending ? editing.total - 1 : 0 }),
    });
    if (!res.ok) { $('#eErr').textContent = (await res.json()).error || 'שגיאה בשמירה'; return; }
    closeEdit();
    load();
  });

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
  $('#logout').addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); all = []; showLogin(); });
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
