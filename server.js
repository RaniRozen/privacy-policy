// שרת אישורי הגעה לבר מצווה של רני – ללא תלויות חיצוניות (Node 18+)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rsvps.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
  console.warn('\n⚠️  לא הוגדר ADMIN_PASSWORD. סיסמה זמנית לריצה הזו בלבד: ' + ADMIN_PASSWORD + '\n');
}
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
const useRemote = Boolean(UP_URL && UP_TOKEN);

async function upstash(cmd) {
  const res = await fetch(UP_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + UP_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error('Upstash: ' + (j.error || res.status));
  return j.result;
}

async function load() {
  if (useRemote) {
    const v = await upstash(['GET', UP_KEY]);
    rsvps = v ? JSON.parse(v) : [];
    console.log('נטענו ' + rsvps.length + ' אישורים מ-Upstash');
  } else {
    try { rsvps = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { rsvps = []; }
    console.warn('⚠️  אחסון בקובץ מקומי – ב-Render חינמי הוא נמחק בהפעלה מחדש. הגדירו UPSTASH_REDIS_REST_URL/TOKEN.');
  }
}

let saveChain = Promise.resolve();
async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  throw last;
}
// מחזירה הבטחה: נדחית אם השמירה נכשלה, כדי שלא נדווח "הצלחה" כשהנתון לא נשמר
function save() {
  if (!useRemote) {
    try {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(rsvps, null, 2));
      fs.renameSync(tmp, DATA_FILE);
      return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  const snapshot = JSON.stringify(rsvps);
  const p = saveChain.then(() => withRetry(() => upstash(['SET', UP_KEY, snapshot])));
  saveChain = p.catch(() => {}); // השרשרת ממשיכה גם אחרי כישלון
  return p;
}
async function saveOr503(res) {
  try { await save(); return true; } catch (e) {
    console.error('שמירה נכשלה:', e.message);
    send(res, 503, { error: 'השמירה לא הצליחה, נסו שוב בעוד רגע' });
    return false;
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
function validToken(tok) {
  if (!tok) return false;
  const [exp, sig] = tok.split('.');
  if (!exp || !sig || !safeEq(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
const isAdmin = (req) => validToken(getCookie(req, 'admin'));
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// הגבלת קצב פשוטה בזיכרון
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  return arr.length > max;
}
setInterval(() => buckets.clear(), 1000 * 60 * 60).unref();

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
    req.on('data', (c) => {
      data += c;
      if (data.length > 10_000) { reject(new Error('too big')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const validDevice = (d) => (typeof d === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(d) ? d : '');
const publicRsvp = ({ device, ...rest }) => rest; // מזהה המכשיר לא יוצא החוצה, גם לא למנהל
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

// ---------- ראוטים ----------
async function handleApi(req, res, url) {
  const open = url.pathname === '/api/admin/login' || url.pathname === '/api/admin/logout';
  if (!ready && !open) return send(res, 503, { error: 'האתר מתעורר, נסו שוב בעוד רגע' });
  // אישור הגעה (ציבורי)
  if (req.method === 'POST' && url.pathname === '/api/rsvp') {
    if (limited('rsvp:' + ipOf(req), 60, 60 * 60 * 1000)) return send(res, 429, { error: 'יותר מדי ניסיונות, נסו שוב מאוחר יותר' });
    let b;
    try { b = await readJson(req); } catch { return send(res, 400, { error: 'בקשה לא תקינה' }); }
    const name = clean(b.name, 60);
    const attending = b.attending === true || b.attending === 'yes';
    const extra = attending ? Math.max(0, Math.min(9, parseInt(b.extra, 10) || 0)) : 0;
    const note = clean(b.note, 300);
    if (name.length < 2) return send(res, 400, { error: 'נא להזין שם' });
    const now = new Date().toISOString();
    const device = validDevice(b.device);
    // קודם לפי מכשיר; אחרת לפי שם – אבל רק אם הרשומה עוד לא שייכת למכשיר אחר
    let existing = device ? rsvps.find((r) => r.device === device) : null;
    if (!existing) existing = rsvps.find((r) => !r.device && r.name.toLowerCase() === name.toLowerCase());
    if (existing) Object.assign(existing, { name, attending, extra, note, updatedAt: now, ...(device && { device }) });
    else rsvps.push({ id: crypto.randomUUID(), device, name, attending, extra, note, createdAt: now, updatedAt: now });
    if (!(await saveOr503(res))) return;
    return send(res, 200, { ok: true });
  }

  // "האם המכשיר הזה כבר נרשם?" – מחזיר רק את הרשומה של אותו מכשיר
  if (req.method === 'GET' && url.pathname === '/api/rsvp/mine') {
    if (limited('mine:' + ipOf(req), 600, 60 * 60 * 1000)) return send(res, 429, { error: 'יותר מדי בקשות' });
    const device = validDevice(url.searchParams.get('device'));
    const r = device && rsvps.find((x) => x.device === device);
    return send(res, 200, { rsvp: r ? { name: r.name, attending: r.attending, extra: r.extra, note: r.note } : null });
  }

  // כניסת מנהל
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const ip = ipOf(req);
    // גם לפי IP וגם כללי (למקרה שמישהו מזייף כתובת IP): כך אי אפשר לנחש סיסמה בכוח
    if (limited('login:' + ip, 8, 15 * 60 * 1000) || limited('login:all', 40, 15 * 60 * 1000)) return send(res, 429, { error: 'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות' });
    let b;
    try { b = await readJson(req); } catch { return send(res, 400, { error: 'בקשה לא תקינה' }); }
    if (typeof b.password !== 'string' || !safeEq(b.password, ADMIN_PASSWORD)) return send(res, 401, { error: 'סיסמה שגויה' });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`,
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // מכאן והלאה – מנהל בלבד
  if (!url.pathname.startsWith('/api/admin/')) return send(res, 404, { error: 'not found' });
  if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && url.pathname === '/api/admin/list') return send(res, 200, { rsvps: rsvps.map(publicRsvp) });

  if (req.method === 'GET' && url.pathname === '/api/admin/export.csv') {
    const esc = (v) => '"' + String(v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
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
    const r = rsvps.find((x) => x.id === url.pathname.split('/').pop());
    if (!r) return send(res, 404, { error: 'לא נמצא' });
    const name = clean(b.name, 60);
    if (name.length < 2) return send(res, 400, { error: 'נא להזין שם' });
    const attending = b.attending === true;
    Object.assign(r, { name, attending, extra: attending ? Math.max(0, Math.min(9, parseInt(b.extra, 10) || 0)) : 0, updatedAt: new Date().toISOString() });
    if (!(await saveOr503(res))) return;
    return send(res, 200, { ok: true, rsvp: publicRsvp(r) });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/rsvp/')) {
    const id = url.pathname.split('/').pop();
    const before = rsvps.length;
    rsvps = rsvps.filter((r) => r.id !== id);
    if (rsvps.length !== before && !(await saveOr503(res))) return;
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'not found' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.ics': 'text/calendar; charset=utf-8',
};

// גרסה שמשתנה בכל שינוי בקבצי האתר – מוזרקת לכתובות ה-CSS/JS כדי שדפדפן לעולם לא יציג קבצים ישנים
const VERSION = (() => {
  const h = crypto.createHash('sha1');
  for (const f of ['style.css', 'app.js', 'actions.js', 'admin.js', 'viewport.js']) {
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch { /* ignore */ }
  }
  return h.digest('hex').slice(0, 10);
})();

const NOT_FOUND = '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>לא נמצא</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#a24c33;font-family:system-ui,sans-serif;text-align:center;color:#16120f"><div style="background:#f8e6c4;border:3px solid #16120f;border-radius:16px;box-shadow:5px 5px 0 #16120f;padding:28px 32px;margin:16px"><h1 style="margin:0 0 8px">הדף לא נמצא</h1><p style="margin:0 0 16px">אבל ההזמנה כאן 🎉</p><a href="/" style="display:inline-block;background:#f7b500;color:#16120f;font-weight:800;text-decoration:none;padding:10px 18px;border:3px solid #16120f;border-radius:12px">לדף ההזמנה</a></div>';

function serveStatic(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'בקשה לא תקינה'); }
  if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
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
    } else {
      headers['Cache-Control'] = 'public, max-age=86400'; // תמונות
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
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
  saveChain.finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
