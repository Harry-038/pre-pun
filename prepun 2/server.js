// PrePun League backend. Node 18+, no dependencies. Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SECRET = process.env.SECRET || 'change-me-in-production', WHSEC = process.env.WEBHOOK_SECRET || '';
const DEV_PAY = process.env.DEV_PAY === '1', MAXV = 100 * 1024 * 1024, UPI_ID = process.env.UPI_ID || '', UPI_NAME = process.env.UPI_NAME || 'PrePun League';
fs.mkdirSync(path.join(DIR, 'videos'), { recursive: true });
const DBF = path.join(DIR, 'db.json');
let db = fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF)) : { users: [], gyms: [], follows: [], leagues: [], subs: [], slots: [], ads: [], reports: [] };
const save = () => { fs.writeFileSync(DBF + '.tmp', JSON.stringify(db)); fs.renameSync(DBF + '.tmp', DBF); };
const id = () => crypto.randomBytes(6).toString('hex'), day = 864e5, today = () => new Date().toISOString().slice(0, 10);
const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const okpw = (pw, h) => { const [s] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(hash(pw, s)), Buffer.from(h)); };
const sign = p => p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('hex');
const token = u => sign(Buffer.from(u.id + '|' + (Date.now() + 7 * day)).toString('base64url'));
function who(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', ''), [p, s] = t.split('.');
  if (!p || !s || sign(p) !== t) return null;
  const [uid, exp] = Buffer.from(p, 'base64url').toString().split('|');
  return +exp > Date.now() ? db.users.find(u => u.id === uid) : null;
}
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && !db.users.some(u => u.role === 'admin')) {
  db.users.push({ id: id(), email: process.env.ADMIN_EMAIL.toLowerCase(), name: 'Admin', role: 'admin', pw: hash(process.env.ADMIN_PASSWORD) }); save();
}
const pub = u => ({ id: u.id, email: u.email, name: u.name, role: u.role });
const myGym = u => db.gyms.find(g => g.owner === u.id);
const err = (c, m) => { const e = new Error(m); e.code = c; return e; };
const need = (u, ...roles) => { if (!u) throw err(401, 'Log in first'); if (roles.length && !roles.includes(u.role)) throw err(403, 'Not allowed for your account type'); };
const adState = a => { const s = db.slots.find(x => x.id === a.slot); return a.st === 'paid' && s && today() > s.end ? 'expired' : a.st; };
const upiLink = a => { const s = db.slots.find(x => x.id === a.slot); return UPI_ID ? `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_NAME)}&am=${s.price}&cu=INR&tn=${encodeURIComponent('PrePun ad ' + a.id)}` : null; };
const tries = {};
function body(req) { return new Promise((res, rej) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) rej(err(413, 'Too large')); }); req.on('end', () => { try { res(d ? JSON.parse(d) : {}); } catch { rej(err(400, 'Invalid JSON')); } }); }); }
const str = (v, n = 200) => String(v || '').trim().slice(0, n);

const routes = {
  'POST /api/register': async (req) => {
    const b = await body(req), email = str(b.email).toLowerCase(), role = b.role === 'gym' ? 'gym' : 'user';
    if (!/^\S+@\S+\.\S+$/.test(email) || str(b.password).length < 8) throw err(400, 'Use a valid email and a password of 8+ characters');
    if (db.users.some(u => u.email === email)) throw err(409, 'This email is already registered');
    const u = { id: id(), email, name: str(b.name, 60) || 'Athlete', role, pw: hash(b.password) }; db.users.push(u);
    if (role === 'gym') {
      if (!str(b.gymName)) throw err(400, 'Enter your gym name');
      let code; do code = (str(b.gymName).replace(/\W/g, '').slice(0, 4) + crypto.randomInt(10, 99)).toUpperCase(); while (db.gyms.some(g => g.code === code));
      db.gyms.push({ id: id(), owner: u.id, name: str(b.gymName, 80), city: str(b.city, 60), desc: '', news: [], code, status: 'pending' });
    }
    save(); return { token: token(u), user: pub(u) };
  },
  'POST /api/login': async (req) => {
    const b = await body(req), k = req.socket.remoteAddress; tries[k] = (tries[k] || []).filter(t => Date.now() - t < 6e5);
    if (tries[k].length >= 10) throw err(429, 'Too many attempts. Try again in 10 minutes');
    const u = db.users.find(x => x.email === str(b.email).toLowerCase());
    if (!u || !okpw(str(b.password, 200), u.pw)) { tries[k].push(Date.now()); throw err(401, 'Wrong email or password'); }
    return { token: token(u), user: pub(u) };
  },
  'GET /api/me': (req, u) => { need(u); return { user: pub(u), gym: u.role === 'gym' ? myGym(u) : undefined, following: db.follows.filter(f => f.user === u.id).map(f => f.gym) }; },
  'GET /api/gyms': (req, u, q) => {
    const s = (q.get('q') || '').toLowerCase(); const g = db.gyms.filter(g => g.status === 'approved' && (g.name + g.city).toLowerCase().includes(s));
    return g.map(g => ({ ...g, owner: undefined, followers: db.follows.filter(f => f.gym === g.id).length, leagues: db.leagues.filter(l => l.gym === g.id).length, verified: db.subs.filter(s => s.st === 'approved' && db.leagues.find(l => l.id === s.league)?.gym === g.id).length }));
  },
  'POST /api/follow': async (req, u) => {
    need(u, 'user'); const b = await body(req), g = db.gyms.find(g => g.code === str(b.code).toUpperCase() && g.status === 'approved');
    if (!g) throw err(404, 'No approved gym has that code');
    const i = db.follows.findIndex(f => f.user === u.id && f.gym === g.id);
    if (b.unfollow) { if (i >= 0) db.follows.splice(i, 1); } else if (i < 0) db.follows.push({ user: u.id, gym: g.id });
    save(); return { ok: true, gym: g.name };
  },
  'POST /api/gym': async (req, u) => {
    need(u, 'gym'); const g = myGym(u), b = await body(req);
    if (b.name) g.name = str(b.name, 80); if (b.city !== undefined) g.city = str(b.city, 60); if (b.desc !== undefined) g.desc = str(b.desc, 500);
    if (b.announce) g.news.unshift(str(b.announce, 300)); save(); return g;
  },
  'GET /api/leagues': () => db.leagues.map(l => ({ ...l, gymName: db.gyms.find(g => g.id === l.gym)?.name })),
  'POST /api/leagues': async (req, u) => {
    need(u, 'gym'); const g = myGym(u), b = await body(req);
    if (g.status !== 'approved') throw err(403, 'Your gym must be approved first');
    if (!str(b.name) || !str(b.exercise) || !/^\d{4}-\d\d-\d\d$/.test(b.deadline || '')) throw err(400, 'Enter a name, exercise and deadline');
    const l = { id: id(), gym: g.id, name: str(b.name, 80), exercise: str(b.exercise, 60), category: str(b.category, 80) || 'Open', deadline: b.deadline, prize: str(b.prize, 40), rules: str(b.rules, 600) };
    db.leagues.push(l); save(); return l;
  },
  'POST /api/submissions': async (req, u, q) => {
    need(u, 'user'); const l = db.leagues.find(l => l.id === q.get('league')), w = +q.get('weight');
    if (!l || !(w > 0)) throw err(400, 'Choose a league and enter a weight');
    if (today() > l.deadline) throw err(400, 'This league has closed');
    const type = req.headers['content-type'] || ''; if (!type.startsWith('video/')) throw err(400, 'Upload a video file');
    const sid = id(), file = path.join(DIR, 'videos', sid), ws = fs.createWriteStream(file); let n = 0;
    await new Promise((res, rej) => { req.on('data', c => { n += c.length; if (n > MAXV) { req.destroy(); ws.destroy(); fs.unlink(file, () => {}); rej(err(413, 'Video is over 100 MB')); } }); req.pipe(ws); ws.on('finish', res); ws.on('error', rej); });
    const s = { id: sid, league: l.id, user: u.id, name: u.name, weight: w, type, st: 'pending', at: Date.now() }; db.subs.push(s); save(); return s;
  },
  'GET /api/submissions/mine': (req, u) => { need(u, 'user'); return db.subs.filter(s => s.user === u.id); },
  'GET /api/submissions/review': (req, u) => { need(u, 'gym', 'admin'); const g = u.role === 'gym' && myGym(u); return db.subs.filter(s => u.role === 'admin' || db.leagues.find(l => l.id === s.league)?.gym === g.id); },
  'GET /api/leaderboard': (req, u, q) => {
    const m = {}; db.subs.filter(s => s.league === q.get('league') && s.st === 'approved').forEach(s => { if (!m[s.user] || s.weight > m[s.user].weight) m[s.user] = { name: s.name, weight: s.weight }; });
    return Object.values(m).sort((a, b) => b.weight - a.weight);
  },
  'GET /api/slots': () => db.slots.map(s => ({ ...s, booked: db.ads.some(a => a.slot === s.id && !['rejected', 'expired'].includes(adState(a))) })),
  'POST /api/slots': async (req, u) => { need(u, 'admin'); const b = await body(req); if (!str(b.label) || !(+b.price >= 0) || !b.start || !b.end || b.end < b.start) throw err(400, 'Fill in label, price and a valid date range'); const s = { id: id(), label: str(b.label, 80), price: +b.price, start: b.start, end: b.end }; db.slots.push(s); save(); return s; },
  'POST /api/ads': async (req, u) => {
    need(u, 'gym'); const g = myGym(u), b = await body(req), s = db.slots.find(s => s.id === b.slot);
    if (g.status !== 'approved') throw err(403, 'Your gym must be approved first'); if (!s || !str(b.text)) throw err(400, 'Choose a slot and write your ad text');
    if (db.ads.some(a => a.slot === s.id && !['rejected', 'expired'].includes(adState(a)))) throw err(409, 'This slot is already booked');
    const a = { id: id(), gym: g.id, slot: s.id, text: str(b.text, 140), st: 'requested' }; db.ads.push(a); save(); return a;
  },
  'GET /api/ads': (req, u) => { need(u, 'gym', 'admin'); const g = u.role === 'gym' && myGym(u); return db.ads.filter(a => u.role === 'admin' || a.gym === g.id).map(a => ({ ...a, st: adState(a), gymName: db.gyms.find(x => x.id === a.gym)?.name, price: db.slots.find(s => s.id === a.slot)?.price, upi: a.st === 'awaiting payment' ? upiLink(a) : null })); },
  'GET /api/config': () => ({ upiEnabled: !!UPI_ID, devPay: DEV_PAY }),
  'GET /api/ads/active': () => db.ads.filter(a => { const s = db.slots.find(x => x.id === a.slot); return a.st === 'paid' && s && s.start <= today() && today() <= s.end; }).map(a => ({ text: a.text, gym: db.gyms.find(g => g.id === a.gym)?.name })),
  'GET /api/admin/stats': (req, u) => { need(u, 'admin'); const paid = db.ads.filter(a => a.st === 'paid'); return { users: db.users.length, gyms: db.gyms.length, approvedGyms: db.gyms.filter(g => g.status === 'approved').length, leagues: db.leagues.length, submissions: db.subs.length, activeAds: paid.filter(a => adState(a) === 'paid').length, revenue: paid.reduce((t, a) => t + (db.slots.find(s => s.id === a.slot)?.price || 0), 0), openReports: db.reports.filter(r => r.open).length }; },
  'GET /api/admin/gyms': (req, u) => { need(u, 'admin'); return db.gyms; },
  'POST /api/report': async (req, u) => { need(u); const b = await body(req); db.reports.push({ id: id(), by: u.id, text: str(b.text, 400), open: true }); save(); return { ok: true }; },
  'GET /api/admin/reports': (req, u) => { need(u, 'admin'); return db.reports; },
  'POST /api/webhook/payment': async (req) => { // payment gateway calls this; verified by HMAC of the raw body
    let raw = ''; for await (const c of req) raw += c;
    const sig = crypto.createHmac('sha256', WHSEC).update(raw).digest('hex');
    if (!WHSEC || sig !== req.headers['x-signature']) throw err(401, 'Bad signature');
    const a = db.ads.find(a => a.id === JSON.parse(raw).adId); if (a && a.st === 'awaiting payment' && today() <= a.due) { a.st = 'paid'; save(); } return { ok: true };
  },
};
// dynamic routes with :id
const dyn = [
  [/^POST \/api\/submissions\/(\w+)\/review$/, async (req, u, q, m) => { need(u, 'gym', 'admin'); const s = db.subs.find(s => s.id === m[1]), b = await body(req); if (!s) throw err(404, 'Not found'); const l = db.leagues.find(l => l.id === s.league); if (u.role === 'gym' && myGym(u).id !== l.gym) throw err(403, 'This submission belongs to another gym'); if (!['approved', 'rejected', 'resubmit'].includes(b.status)) throw err(400, 'Bad status'); s.st = b.status; save(); return s; }],
  [/^GET \/api\/videos\/(\w+)$/, (req, u, q, m, res) => { need(u); const s = db.subs.find(s => s.id === m[1]); if (!s) throw err(404, 'Not found'); const l = db.leagues.find(l => l.id === s.league), g = u.role === 'gym' && myGym(u); if (!(u.role === 'admin' || s.user === u.id || (g && g.id === l.gym))) throw err(403, 'Not allowed'); res.writeHead(200, { 'Content-Type': s.type }); fs.createReadStream(path.join(DIR, 'videos', s.id)).pipe(res); return 'stream'; }],
  [/^POST \/api\/admin\/gyms\/(\w+)$/, async (req, u, q, m) => { need(u, 'admin'); const g = db.gyms.find(g => g.id === m[1]), b = await body(req); if (!g || !['approved', 'rejected', 'pending'].includes(b.status)) throw err(400, 'Bad request'); g.status = b.status; save(); return g; }],
  [/^POST \/api\/ads\/(\w+)\/decide$/, async (req, u, q, m) => { need(u, 'admin'); const a = db.ads.find(a => a.id === m[1]), b = await body(req); if (!a || a.st !== 'requested') throw err(400, 'Request not found'); if (b.approve) { a.st = 'awaiting payment'; a.due = new Date(Date.now() + 3 * day).toISOString().slice(0, 10); } else a.st = 'rejected'; save(); return a; }],
  [/^POST \/api\/ads\/(\w+)\/pay-dev$/, (req, u, q, m) => { need(u, 'gym'); if (!DEV_PAY) throw err(403, 'Test payments are off. Connect a payment gateway'); const a = db.ads.find(a => a.id === m[1] && a.gym === myGym(u).id); if (!a || a.st !== 'awaiting payment') throw err(400, 'Nothing to pay'); a.st = 'paid'; save(); return a; }],
  [/^POST \/api\/ads\/(\w+)\/claim-payment$/, (req, u, q, m) => { need(u, 'gym'); const a = db.ads.find(a => a.id === m[1] && a.gym === myGym(u).id); if (!a || a.st !== 'awaiting payment') throw err(400, 'Nothing to confirm'); if (today() > a.due) throw err(400, 'The payment window has passed'); a.st = 'payment claimed'; save(); return a; }],
  [/^POST \/api\/ads\/(\w+)\/confirm-payment$/, (req, u, q, m) => { need(u, 'admin'); const a = db.ads.find(a => a.id === m[1]); if (!a || !['payment claimed', 'awaiting payment'].includes(a.st)) throw err(400, 'Nothing to confirm'); a.st = 'paid'; save(); return a; }],
  [/^POST \/api\/admin\/reports\/(\w+)$/, (req, u, q, m) => { need(u, 'admin'); const r = db.reports.find(r => r.id === m[1]); if (r) r.open = false; save(); return { ok: true }; }],
];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), key = req.method + ' ' + url.pathname;
  const H = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST' };
  if (req.method === 'OPTIONS') { res.writeHead(204, H); return res.end(); }
  try {
    if (url.pathname.startsWith('/api/')) {
      const u = who(req); let out;
      if (routes[key]) out = await routes[key](req, u, url.searchParams);
      else { const d = dyn.find(([r]) => r.test(key)); if (!d) throw err(404, 'Unknown endpoint'); out = await d[1](req, u, url.searchParams, key.match(d[0]), res); }
      if (out === 'stream') return;
      res.writeHead(200, { ...H, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
    }
    const f = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, ''));
    if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, H); return res.end('Not found'); }
    res.writeHead(200, { ...H, 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  } catch (e) { if (!res.headersSent) res.writeHead(e.code || 500, { ...H, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.code ? e.message : 'Something went wrong' })); if (!e.code) console.error(e); }
}).listen(PORT, () => console.log('PrePun League on :' + PORT));
