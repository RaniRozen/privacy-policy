// שרת אישורי הגעה לבר מצווה של רני – ללא תלויות חיצוניות (Node 18+)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rsvps.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
  console.warn('\n⚠️  לא הוגדר ADMIN_PASSWORD. סיסמה זמנית לריצה הזו בלבד: ' + ADMIN_PASSWORD + '\n');
}
if (process.env.ADMIN_PASSWORD && ADMIN_PASSWORD.length < 12) console.warn('⚠️  ADMIN_PASSWORD קצרה מ-12 תווים – מומלץ סיסמה חזקה יותר.');
// מפתח החתימה נגזר מהסיסמה – שינוי סיסמה מנתק אוטומטית את כל החיבורים הקיימים
const SECRET = crypto.createHash('sha256').update('rani-bm|' + ADMIN_PASSWORD).digest();
const SESSION_MS = 1000 * 60 * 60 * 12;

fs.mkdirSync(DATA_DIR, { recursive: true });
let rsvps = [];
let ready = false; // נהיה true רק אחרי שהנתונים נטענו, כדי לא לדרוס נתונים קיימים בטעות

// אחסון: אם הוגדרו משתני Upstash – נשמר שם (חינם, שורד הפעלה מחדש). אחרת – קובץ מקומי.
const UP_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const UP_KEY = 'rani:rsvps';
const UP_HISTORY = 'rani:rsvps:history'; // 60 הגרסאות האחרונות של הרשימה (גיבוי אוטומטי בכל שמירה)
const UP_TRASH = 'rani:rsvps:trash';     // כל רשומה שנמחקה במסך הניהול נשמרת כאן (אפשר לשחזר)
const HISTORY_KEEP = 60;
const MAX_RECORDS = 1000; // מתחת למגבלת הגודל של Upstash החינמי (כ-1MB לערך)
const useRemote = Boolean(UP_URL && UP_TOKEN);

async function upstash(cmd) {
  const res = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + UP_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(8000), // בלי זה, מסד שלא עונה היה תוקע את כל הכתיבות
  });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error('Upstash: ' + (j.error || res.status));
  return j.result;
}

async function load() {
  if (useRemote) {
    const v = await upstash(['GET', UP_KEY]);
    const parsed = v ? JSON.parse(v) : [];
    // ערך שאינו רשימה = משהו לא תקין. עדיף שהשרת יסרב לעלות מאשר שידרוס אותו ברשימה ריקה
    if (!Array.isArray(parsed)) throw new Error('הנתונים במסד אינם רשימה תקינה – לא דורסים');
    rsvps = parsed;
    console.log('נטענו ' + rsvps.length + ' אישורים מ-Upstash');
  } else {
    try { rsvps = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') rsvps = [];
      else throw new Error('קובץ הנתונים קיים אך לא נקרא (' + e.message + ') – לא דורסים'); // קובץ פגום לא נדרס ברשימה ריקה
    }
    if (!Array.isArray(rsvps)) throw new Error('קובץ הנתונים אינו רשימה תקינה – לא דורסים');
    console.warn('⚠️  אחסון בקובץ מקומי – ב-Render חינמי הוא נמחק בהפעלה מחדש. הגדירו UPSTASH_REDIS_REST_URL/TOKEN.');
  }
}

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  throw last;
}
async function persist(list) {
  // רשת ביטחון אחרונה: אף פעולה רגילה לא מסירה יותר מרשומה אחת בבת אחת. אם הרשימה "מתכווצת" מעבר לכך – זו תקלה, ולא שומרים.
  if (list.length < rsvps.length - 1) throw new Error('סירוב לשמור: הרשימה התכווצה מ-' + rsvps.length + ' ל-' + list.length);
  if (!useRemote) {
    const tmp = DATA_FILE + '.tmp';
    const body = JSON.stringify(list, null, 2);
    fs.writeFileSync(tmp, body);
    try { if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak'); } catch { /* גיבוי הוא בונוס */ }
    fs.renameSync(tmp, DATA_FILE);
    return;
  }
  const snapshot = JSON.stringify(list);
  await withRetry(() => upstash(['SET', UP_KEY, snapshot]));
  // גיבוי היסטוריה: לא קריטי לתהליך, ולכן כשל בו לא מכשיל את הרישום
  upstash(['LPUSH', UP_HISTORY, snapshot]).then(() => upstash(['LTRIM', UP_HISTORY, 0, HISTORY_KEEP - 1])).catch((e) => console.error('גיבוי היסטוריה נכשל:', e.message));
}
// שומר עותק של רשומה שנמחקה (לשחזור). כשל כאן לא מונע את המחיקה אבל נרשם ביומן.
function archiveDeleted(record) {
  const entry = JSON.stringify({ deletedAt: new Date().toISOString(), record });
  if (useRemote) upstash(['LPUSH', UP_TRASH, entry]).catch((e) => console.error('ארכוב רשומה שנמחקה נכשל:', e.message));
  else { try { fs.appendFileSync(DATA_FILE + '.trash.jsonl', entry + '\n'); } catch (e) { console.error('ארכוב נכשל:', e.message); } }
}

// שגיאה עם קוד HTTP, שמוחזרת ללקוח כמו שהיא
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// כתיבה טרנזקציונלית: כל השינויים מתבצעים בתור (אחד אחרי השני), על עותק.
// רק אם השמירה הצליחה העותק הופך לנתונים הנוכחיים – כך הזיכרון והמסד אף פעם לא מתפצלים,
// ואם השמירה נכשלת, השינוי מתבטל והלקוח מקבל שגיאה.
let txChain = Promise.resolve();
function mutate(fn) {
  const run = async () => {
    const draft = structuredClone(rsvps);
    const out = fn(draft);
    await persist(draft);
    rsvps = draft;
    return out;
  };
  const p = txChain.then(run);
  txChain = p.catch(() => {});
  return p;
}
async function mutateOrReply(res, fn) {
  try { return { ok: true, out: await mutate(fn) }; } catch (e) {
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else { console.error('שמירה נכשלה:', e.message); send(res, 503, { error: 'השמירה לא הצליחה, נסו שוב בעוד רגע' }); }
    return { ok: false };
  }
}

// ---------- עזרים ----------
const safeEq = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function makeToken() {
  const exp = String(Date.now() + SESSION_MS);
  return exp + '.' + sign(exp);
}
const revoked = new Map(); // חתימות של עוגיות שהמנהל יצא איתן: נחסמות גם אם מישהו העתיק אותן
function validToken(tok) {
  if (!tok || typeof tok !== 'string') return false;
  const [exp, sig] = tok.split('.');
  if (!exp || !sig || !safeEq(sig, sign(exp))) return false;
  if (revoked.has(sig)) return false;
  return Number(exp) > Date.now();
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  if (!m) return '';
  try { return decodeURIComponent(m.slice(name.length + 1)); } catch { return ''; } // עוגייה פגומה = לא מחובר, לא שגיאת שרת
}
const isAdmin = (req) => validToken(getCookie(req, 'admin'));
// ה-proxy של Render מוסיף את כתובת הלקוח האמיתית בסוף הרשימה; הערכים שלפניה נשלטים ע"י הלקוח ולכן לא סומכים עליהם
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();

// הגבלת קצב פשוטה בזיכרון
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  return arr.length > max;
}
// ספירת כישלונות בלבד (כניסה מוצלחת לא "שורפת" מכסה). חוסמים לפני בדיקת הסיסמה כדי שגם ניחוש נכון בזמן נעילה יידחה.
function blocked(key, max, windowMs) {
  const now = Date.now();
  return (buckets.get(key) || []).filter((t) => now - t < windowMs).length >= max;
}
function recordFail(key) {
  const arr = buckets.get(key) || [];
  arr.push(Date.now());
  buckets.set(key, arr);
}
// ניקוי שוטף של רשומות ישנות (במקום לאפס הכול, כדי שחלון הנעילה לא יתאפס בשעה עגולה)
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const fresh = arr.filter((t) => now - t < 60 * 60 * 1000);
    if (fresh.length) buckets.set(k, fresh); else buckets.delete(k);
  }
  for (const [s, exp] of revoked) if (exp < now) revoked.delete(s);
}, 5 * 60 * 1000).unref();

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  }, undefined);
  res.end(isObj ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8'); // בלי זה, אות עברית שנחתכת בין שני חלקי נתונים הייתה מתקלקלת
    req.on('data', (c) => {
      data += c;
      if (data.length > 10_000) { reject(new Error('too big')); req.destroy(); }
    });
    req.on('end', () => {
      try {
        const j = JSON.parse(data || '{}');
        if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object');
        resolve(j);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const validDevice = (d) => (typeof d === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(d) ? d : '');
const publicRsvp = ({ device, ...rest }) => rest; // מזהה המכשיר לא יוצא החוצה, גם לא למנהל
// מסירים תווי בקרה, תגיות HTML, ותווי כיווניות/רוחב-אפס (מונעים זיוף שמות בתצוגה, למשל היפוך טקסט)
const clean = (s, n) => (typeof s === 'string' || typeof s === 'number' ? String(s) : '')
  .normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f<>\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- ראוטים ----------
async function handleApi(req, res, url) {
  // הגנת CSRF: בקשות שמשנות מצב חייבות להגיע מהאתר עצמו (Origin זהה) וב-JSON
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin) {
      let same = false;
      try { same = new URL(origin).host === req.headers.host; } catch { /* מקור לא תקין */ }
      if (!same) return send(res, 403, { error: 'forbidden' });
    }
    if (req.method !== 'DELETE' && !/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'unsupported' });
  }
  const open = url.pathname === '/api/admin/login' || url.pathname === '/api/admin/logout';
  if (!ready && !open) return send(res, 503, { error: 'האתר מתעורר, נסו שוב בעוד רגע' });
  // אישור הגעה (ציבורי)
  if (req.method === 'POST' && url.pathname === '/api/rsvp') {
    // מגבלה נדיבה לפי כתובת (כתובת אחת יכולה להיות משותפת להרבה אורחים באותה רשת/אזור)
    if (limited('rsvp:' + ipOf(req), 300, 60 * 60 * 1000)) return send(res, 429, { error: 'יותר מדי ניסיונות, נסו שוב מאוחר יותר' });
    let b;
    try { b = await readJson(req); } catch { return send(res, 400, { error: 'בקשה לא תקינה' }); }
    const name = clean(b.name, 60);
    const attending = b.attending === true || b.attending === 'yes';
    const extra = attending ? Math.max(0, Math.min(9, parseInt(b.extra, 10) || 0)) : 0;
    const note = clean(b.note, 300);
    if (name.length < 2) return send(res, 400, { error: 'נא להזין שם' });
    const device = validDevice(b.device);
    if (device && limited('dev:' + device, 30, 60 * 60 * 1000)) return send(res, 429, { error: 'יותר מדי ניסיונות, נסו שוב מאוחר יותר' });
    const r = await mutateOrReply(res, (list) => {
      const now = new Date().toISOString();
      // קודם לפי מכשיר; אחרת לפי שם, אבל רק אם הרשומה עוד לא שייכת למכשיר אחר
      let existing = device ? list.find((x) => x.device === device) : null;
      if (!existing) existing = list.find((x) => !x.device && x.name.toLowerCase() === name.toLowerCase());
      if (existing) Object.assign(existing, { name, attending, extra, note, updatedAt: now, ...(device && { device }) });
      else {
        if (list.length >= MAX_RECORDS) throw new HttpError(503, 'האתר עמוס כרגע, נסו שוב מאוחר יותר'); // הגנה מפני הצפה
        list.push({ id: crypto.randomUUID(), device, name, attending, extra, note, createdAt: now, updatedAt: now });
      }
    });
    if (!r.ok) return;
    return send(res, 200, { ok: true });
  }

  // "האם המכשיר הזה כבר נרשם?" – מחזיר רק את הרשומה של אותו מכשיר
  if (req.method === 'GET' && url.pathname === '/api/rsvp/mine') {
    if (limited('mine:' + ipOf(req), 5000, 60 * 60 * 1000)) return send(res, 429, { error: 'יותר מדי בקשות' });
    const device = validDevice(url.searchParams.get('device'));
    const r = device && rsvps.find((x) => x.device === device);
    return send(res, 200, { rsvp: r ? { name: r.name, attending: r.attending, extra: r.extra, note: r.note } : null });
  }

  // כניסת מנהל
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const ipKey = 'fail:' + ipOf(req);
    // חסימה לפי כתובת וגם כללית (למקרה של התקפה מהרבה כתובות), לפני בדיקת הסיסמה
    if (blocked(ipKey, 8, 15 * 60 * 1000) || blocked('fail:all', 60, 15 * 60 * 1000)) return send(res, 429, { error: 'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות' });
    let b;
    try { b = await readJson(req); } catch { recordFail(ipKey); return send(res, 400, { error: 'בקשה לא תקינה' }); }
    if (typeof b.password !== 'string' || !safeEq(b.password, ADMIN_PASSWORD)) {
      recordFail(ipKey); recordFail('fail:all');
      return send(res, 401, { error: 'סיסמה שגויה' });
    }
    const secure = (req.headers['x-forwarded-proto'] === 'https' || process.env.RENDER) ? '; Secure' : '';
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`,
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    const tok = getCookie(req, 'admin');
    const [exp, sig] = tok.split('.');
    if (sig && validToken(tok)) revoked.set(sig, Number(exp)); // מבטלים את העוגייה גם בשרת
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // מכאן והלאה – מנהל בלבד
  if (!url.pathname.startsWith('/api/admin/')) return send(res, 404, { error: 'not found' });
  if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && url.pathname === '/api/admin/list') return send(res, 200, { rsvps: rsvps.map(publicRsvp) });

  // גיבוי מלא להורדה (כולל כל השדות), לשחזור ידני אם יהיה צורך
  if (req.method === 'GET' && url.pathname === '/api/admin/backup.json') {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    return send(res, 200, JSON.stringify(rsvps, null, 2), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="rani-backup-${stamp}.json"`,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/export.csv') {
    const esc = (v) => '"' + String(v).replace(/"/g, '""').replace(/^([=+\-@\t\r])/, "'$1") + '"';
    const rows = [['שם', 'סטטוס', 'מלווים', 'סה"כ אנשים', 'הערה', 'תאריך']].concat(
      rsvps.map((r) => [r.name, r.attending ? 'מגיע/ה' : 'לא מגיע/ה', r.extra, r.attending ? 1 + r.extra : 0, r.note, r.updatedAt]));
    return send(res, 200, '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n'), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rani-rsvps.csv"',
    });
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/admin/rsvp/')) {
    let b;
    try { b = await readJson(req); } catch { return send(res, 400, { error: 'בקשה לא תקינה' }); }
    const id = url.pathname.split('/').pop();
    const name = clean(b.name, 60);
    if (name.length < 2) return send(res, 400, { error: 'נא להזין שם' });
    const attending = b.attending === true;
    const extra = attending ? Math.max(0, Math.min(9, parseInt(b.extra, 10) || 0)) : 0;
    const r = await mutateOrReply(res, (list) => {
      const t = list.find((x) => x.id === id);
      if (!t) throw new HttpError(404, 'לא נמצא');
      Object.assign(t, { name, attending, extra, updatedAt: new Date().toISOString() });
      return publicRsvp(t);
    });
    if (!r.ok) return;
    return send(res, 200, { ok: true, rsvp: r.out });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/rsvp/')) {
    const id = url.pathname.split('/').pop();
    const r = await mutateOrReply(res, (list) => {
      const i = list.findIndex((x) => x.id === id);
      if (i === -1) throw new HttpError(404, 'לא נמצא');
      return list.splice(i, 1)[0];
    });
    if (!r.ok) return;
    archiveDeleted(r.out); // המחיקה לא סופית: העותק נשמר בסל האשפה במסד
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'not found' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ics': 'text/calendar; charset=utf-8',
};

// גרסה שמשתנה בכל שינוי בקבצי האתר – מוזרקת לכתובות ה-CSS/JS כדי שדפדפן לעולם לא יציג קבצים ישנים
const VERSION = (() => {
  const h = crypto.createHash('sha1');
  for (const f of ['style.css', 'app.js', 'actions.js', 'admin.js', 'viewport.js']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch { /* ignore */ }
  }
  return h.digest('hex').slice(0, 10);
})();

const NOT_FOUND = '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>לא נמצא</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#a24c33;font-family:system-ui,sans-serif;text-align:center;color:#16120f"><div style="background:#f8e6c4;border:3px solid #16120f;border-radius:16px;box-shadow:5px 5px 0 #16120f;padding:28px 32px;margin:16px"><h1 style="margin:0 0 8px">הדף לא נמצא</h1><p style="margin:0 0 16px">אבל אישורי ההגעה כאן 🎉</p><a href="/" style="display:inline-block;background:#f7b500;color:#16120f;font-weight:800;text-decoration:none;padding:10px 18px;border:3px solid #16120f;border-radius:12px">לאישורי ההגעה</a></div>';

const gzCache = new Map();
function serveStatic(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'בקשה לא תקינה'); }
  if (p.includes('\0')) return send(res, 400, 'בקשה לא תקינה');
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '') || '/'; // /admin/ זהה ל-/admin
  if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
  if (/(^|\/)\./.test(p)) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(NOT_FOUND); } // אין חשיפת קבצים נסתרים
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(NOT_FOUND); }
    const ext = path.extname(file);
    if (ext === '.html') buf = Buffer.from(buf.toString('utf8').replaceAll('__V__', VERSION));
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (['.html', '.css', '.js', '.ics'].includes(ext)) {
      // קבצי האתר: הדפדפן תמיד בודק מול השרת (ETag), כך שעדכונים מגיעים מיד ולא נתקעים בזיכרון
      const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex') + '"';
      headers.ETag = etag;
      headers['Cache-Control'] = 'no-cache';
      if (p === '/admin.html') { headers['X-Robots-Tag'] = 'noindex, nofollow'; headers['Cache-Control'] = 'no-store'; }
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
      // דחיסת gzip (עם מטמון לפי תוכן) – חוסך כ-70% מהנתונים בטלפון
      headers.Vary = 'Accept-Encoding';
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && buf.length > 512) {
        let z = gzCache.get(etag);
        if (!z) { z = zlib.gzipSync(buf, { level: 9 }); if (gzCache.size < 50) gzCache.set(etag, z); }
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, headers);
        return res.end(z);
      }
    } else {
      headers['Cache-Control'] = ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=86400'; // גופנים ותמונות
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/healthz') return send(res, 200, 'ok'); // לבדיקת חיים / שירותי ניטור
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'שגיאת שרת' });
  }
});
server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 50;

// השרת מתחיל להאזין מיד (כדי שהאתר יעלה מהר); ה-API מחזיר 503 עד שהנתונים נטענו, עם ניסיונות חוזרים
server.listen(PORT, () => console.log('רץ על http://localhost:' + PORT + '   (ניהול: /admin)'));
(async () => {
  for (let i = 0; !ready; i++) {
    try { await load(); ready = true; } catch (e) {
      console.error('טעינת נתונים נכשלה, מנסה שוב:', e.message);
      await new Promise((r) => setTimeout(r, Math.min(15000, 2000 * (i + 1))));
    }
  }
})();

// סגירה מסודרת (Render שולח SIGTERM בכל פריסה): ממתינים לשמירה שבדרך
function shutdown() {
  server.close();
  txChain.finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
