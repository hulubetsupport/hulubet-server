/**
 * HULU BET - Production Server (Complete v4.5 Enterprise Master)
 * ZERO CODE DECREASED - All original systems preserved + New additions:
 *  - Automated Payment Gateway Checker (Telebirr 0996910607 / CBE 1000562339427 - Aymen)
 *  - Daily 10% Automated Cashback Engine at 10:00 AM EAT (Addis Ababa Time)
 *  - Real DB-backed Sports Betting & Cashout Endpoints
 *  - Support for all 12 Games (Crash, Keno, Chicken Series, Slots, Blocks, Plinko, Roulette)
 *  - Full Admin Panel, Sweeper Crons, Promo Codes & Telegram Security
 */
'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const ENV = process.env;
for (const k of ['DATABASE_URL', 'BOT_TOKEN', 'ADMIN_PIN']) {
  if (!ENV[k]) { console.error(`FATAL: ${k} is missing in Render environment variables.`); process.exit(1); }
}
if (ENV.ADMIN_PIN.length < 8) { console.error('FATAL: ADMIN_PIN must be at least 8 characters.'); process.exit(1); }

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(cors());
app.use(express.json({ limit: '100kb' }));

const pool = new Pool({
  connectionString: ENV.DATABASE_URL.replace(/[?&]channel_binding=require/, ''),
  ssl: { rejectUnauthorized: false },
  max: 25, idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000
});
pool.on('error', e => console.error('pg idle client error:', e.message));

// ===================== SYSTEM CONFIGURATION =====================
const CONFIG = {
  TARGET_RTP: 0.85, AGENT_COMMISSION: 0.02, WELCOME_BONUS: 20, REFERRAL_BONUS: 50,
  MIN_FIRST_DEP: 50, WAGER_REQ_MULT: 3, MIN_DEP: 50, MAX_DEP: 100000, MIN_WTH: 100, MAX_WTH: 50000,
  MIN_BET: 1, MAX_BET: 1000, MAX_PAYOUT: 20000, SAFETY_BUFFER: 50000, MAX_CRASH: 100,
  DAILY_WTH_LIMIT: 100000, MAX_PENDING_WTH: 2, REVIEW_AMOUNT: 10000, DEP_EXPIRE_HOURS: 24,
  DAILY_CASHBACK_PERCENT: 0.10 // 10% Daily Cashback at 10:00 AM
};

// Payment Gateway Microservice Config
const GATEWAY = {
  API_URL: 'https://verifi-server.onrender.com/api/verify',
  TOKEN: 'Verifi_Prod_9842_Aymen_X9!2026',
  ACCOUNTS: {
    Telebirr: { num: '0996910607', name: 'Aymen' },
    CBE: { num: '1000562339427', name: 'Aymen' }
  }
};

const AGENTS = ['Agent1hulubet', 'Agent2hulubet', 'Aymen'];
const CRASH_GAMES = ['Aviator', 'JetX', 'AviaMasters'];
const INSTANT_GAMES = ['KenoFast', 'ClassicKeno', 'Slot777', 'MegaBlock', 'AviaMasters', 'PlinkoX', 'Plinko', 'Roulette'];
const CHICKEN_GAMES = ['ChickenRoad2', 'LuckyChicken', 'RoastedChicken'];
const CHICKEN_GAME = 'ChickenRoad2';
const PAY_METHODS = ['Telebirr', 'CBE'];

// <PURE>
const r2 = n => Math.round(Number(n) * 100) / 100;
const num = v => parseFloat(v || 0) || 0;

// ---- Crash math (shared formula) ----
const CRASH_A = 0.065, CRASH_B = 0.035, CRASH_C = 1.48, GRACE = 0.3;
const growth = t => Math.floor((1 + CRASH_A * t + CRASH_B * Math.pow(t, CRASH_C)) * 100) / 100;

function crashPointFromSeed(seed, roundId, rtp, maxMult) {
  const h = crypto.createHmac('sha256', seed).update(roundId).digest('hex');
  const u = parseInt(h.slice(0, 13), 16) / Math.pow(2, 52);
  const cp = Math.floor((rtp / (1 - u)) * 100) / 100;
  return Math.min(maxMult, Math.max(1.0, cp));
}

function decideCrash({ cp, auto, el, cashout, clientMult }) {
  const mSrv = growth(el), mChk = growth(Math.max(0, el - GRACE));
  const autoOk = auto && auto < cp;
  if (cashout) {
    let claim = Math.floor(Math.min(Number(clientMult) || 0, mSrv) * 100) / 100;
    if (autoOk && claim > auto) claim = auto;
    if (claim < 1.01) return { state: 'EARLY' };
    return claim < cp ? { state: 'WON', mult: claim } : { state: 'CRASHED' };
  }
  if (autoOk && mSrv >= auto) return { state: 'WON', mult: auto };
  if (mChk >= cp) return { state: 'CRASHED' };
  return { state: 'FLYING' };
}

// ---- Keno math ----
const C = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
const kenoMemo = new Map();
function kenoTable(k, rtp) {
  const key = k + ':' + rtp;
  if (kenoMemo.has(key)) return kenoMemo.get(key);
  const tot = C(80, 20), p = h => C(k, h) * C(80 - k, 20 - h) / tot;
  const from = Math.ceil(k / 3), hs = [];
  for (let h = from; h <= k; h++) hs.push(h);
  const w = hs.map((_, i) => Math.pow(0.55, i)), ws = w.reduce((a, b) => a + b, 0);
  const t = new Array(k + 1).fill(0);
  hs.forEach((h, i) => { t[h] = Math.min(250, Math.floor((w[i] / ws) * rtp / p(h) * 100) / 100); });
  kenoMemo.set(key, t);
  return t;
}
function kenoDraw() {
  const a = Array.from({ length: 80 }, (_, i) => i + 1);
  for (let i = 79; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, 20);
}
function kenoRound(picks, rtp) {
  const drawn = kenoDraw(), hits = picks.filter(n => drawn.includes(n)).length;
  return { drawn, hits, multiplier: kenoTable(picks.length, rtp)[hits] || 0 };
}

// ===================== REAL GAME MECHANICS =====================
class Bad extends Error {}
const rint = n => crypto.randomInt(0, n);
const pick = (pairs) => {
  let t = 0; for (const [, w] of pairs) t += w;
  let x = crypto.randomInt(0, 1e6) / 1e6 * t;
  for (const [v, w] of pairs) { if (x < w) return v; x -= w; }
  return pairs[pairs.length - 1][0];
};

// ---- Slot 777 & MegaBlock ----
const SLOT = {
  ids: ['77', 'DOLLAR', 'BELL', 'MELON', 'MANY_GRAPES', 'PLUM', 'LEMON', 'ORANGE', 'CHERRY'],
  w: [1, 2, 3, 4, 4, 6, 7, 7, 8], triple: [30, 20, 12, 8, 8, 5, 5, 5, 5], pair: [3, 2.5, 2, 1.5, 1.5, 1, 1, 1, 1],
  col: [[1, 0.85], [3, 0.10], [5, 0.05]]
};
const slotMemo = new Map();
function slotTable(rtp) {
  if (slotMemo.has(rtp)) return slotMemo.get(rtp);
  const tw = SLOT.w.reduce((a, b) => a + b, 0), p = SLOT.w.map(x => x / tw);
  let base = 0, hit = 0;
  for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) for (let c = 0; c < 9; c++) {
    const pr = p[a] * p[b] * p[c]; let m = 0;
    if (a === b && b === c) m = SLOT.triple[a]; else if (a === b || a === c) m = SLOT.pair[a]; else if (b === c) m = SLOT.pair[b];
    base += pr * m; if (m > 0) hit += pr;
  }
  const ecol = SLOT.col.reduce((a, [m, q]) => a + m * q, 0), f = rtp / (base * ecol);
  const t = { f, hit, triple: SLOT.triple.map(x => r2(x * f)), pair: SLOT.pair.map(x => r2(x * f)) };
  slotMemo.set(rtp, t); return t;
}
function slotSpin(rtp) {
  const t = slotTable(rtp), idx = [0, 1, 2].map(() => pick(SLOT.w.map((w, i) => [i, w])));
  const colMult = pick(SLOT.col.map(([m, q]) => [m, q]));
  const [a, b, c] = idx; let winType = 'NONE', winReels = [], m = 0;
  if (a === b && b === c) { winType = 'TRIPLE'; winReels = [0, 1, 2]; m = t.triple[a]; }
  else if (a === b) { winType = 'PAIR'; winReels = [0, 1]; m = t.pair[a]; }
  else if (b === c) { winType = 'PAIR'; winReels = [1, 2]; m = t.pair[b]; }
  else if (a === c) { winType = 'PAIR'; winReels = [0, 2]; m = t.pair[a]; }
  return { reels: idx.map(i => SLOT.ids[i]), colMult, winType, winReels, mult: m > 0 ? r2(m * colMult) : 0 };
}

// ---- Plinko ----
const PL_SHAPE = {
  low: [20, 10, 5, 2, 1.5, 1.3, 1.1, 0.8, 0.5, 0.8, 1.1, 1.3, 1.5, 2, 5, 10, 20],
  medium: [100, 25, 10, 5, 2, 1.4, 0.6, 0.4, 0.2, 0.4, 0.6, 1.4, 2, 5, 10, 25, 100],
  high: [1000, 130, 26, 9, 4, 2, 0.2, 0.1, 0, 0.1, 0.2, 2, 4, 9, 26, 130, 1000]
};
const PL_BALLS = [1, 5, 10, 25];
const plMemo = new Map();
function plinkoTable(risk, rtp) {
  const key = risk + ':' + rtp; if (plMemo.has(key)) return plMemo.get(key);
  const s = PL_SHAPE[risk], pr = s.map((_, i) => C(16, i) / 65536), r0 = s.reduce((a, m, i) => a + m * pr[i], 0), f = rtp / r0;
  const t = s.map(m => r2(m * f)); plMemo.set(key, t); return t;
}
function plinkoBall() { const path = []; let b = 0; for (let i = 0; i < 16; i++) { const d = rint(2); path.push(d); b += d; } return { path, bucket: b }; }
function plinkoPlay(wager, cd, rtp) {
  const risk = String(cd.risk || 'medium'); if (!PL_SHAPE[risk]) throw new Bad('Invalid risk level');
  const n = Number(cd.ballCount || 1); if (!PL_BALLS.includes(n)) throw new Bad('Invalid ball count');
  const unit = r2(wager / n); if (Math.abs(unit * n - wager) > 0.011 || unit < 1) throw new Bad('Each ball must be at least 1 ETB');
  const table = plinkoTable(risk, rtp); let payout = 0; const balls = [];
  for (let i = 0; i < n; i++) { const b = plinkoBall(), mult = table[b.bucket], pay = r2(unit * mult); payout += pay; balls.push({ path: b.path, bucket: b.bucket, mult, payout: pay }); }
  return { payout: r2(payout), visual: { rows: 16, risk, unitBet: unit, balls }, tier: `Plinko ${risk} x${n}`, roll: balls[0].bucket };
}

// ---- Roulette ----
const ROUL_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const rouletteColor = n => n === 0 ? 'green' : (ROUL_RED.has(n) ? 'red' : 'black');
const rouletteValid = t => /^num-(?:[0-9]|[12][0-9]|3[0-6])$/.test(t) || /^col-[123]$/.test(t) || /^dozen-[123]$/.test(t) || ['low', 'high', 'even', 'odd', 'red', 'black'].includes(t);
function rouletteReturn(t, n) {
  if (t.startsWith('num-')) return n === Number(t.slice(4)) ? 36 : 0;
  if (n === 0) return 0;
  if (t.startsWith('col-')) return (n % 3 || 3) === Number(t.slice(4)) ? 3 : 0;
  if (t.startsWith('dozen-')) return Math.ceil(n / 12) === Number(t.slice(6)) ? 3 : 0;
  if (t === 'low') return n <= 18 ? 2 : 0; if (t === 'high') return n >= 19 ? 2 : 0;
  if (t === 'even') return n % 2 === 0 ? 2 : 0; if (t === 'odd') return n % 2 === 1 ? 2 : 0;
  if (t === 'red') return ROUL_RED.has(n) ? 2 : 0; return !ROUL_RED.has(n) ? 2 : 0;
}
function roulettePlay(wager, cd, maxPayout) {
  const bets = cd.bets || [{ type: cd.type || 'red', amount: wager }];
  if (!Array.isArray(bets) || !bets.length || bets.length > 80) throw new Bad('Place at least one bet');
  const norm = new Map(); let total = 0;
  for (const b of bets) { const amt = r2(b && b.amount); if (!b || !rouletteValid(String(b.type)) || !(amt >= 1)) throw new Bad('Invalid roulette bet'); norm.set(b.type, r2((norm.get(b.type) || 0) + amt)); total = r2(total + amt); }
  if (Math.abs(total - wager) > 0.001) throw new Bad('Bet total does not match the chips on the table');
  let worst = 0; for (let n = 0; n <= 36; n++) { let ret = 0; norm.forEach((a, t) => { ret += a * rouletteReturn(t, n); }); worst = Math.max(worst, ret); }
  if (worst > maxPayout) throw new Bad(`Maximum payout per spin is ${maxPayout} ETB. Reduce your straight-up bets.`);
  const n = rint(37), parts = []; let payout = 0;
  norm.forEach((a, t) => { const ret = r2(a * rouletteReturn(t, n)); payout += ret; parts.push({ type: t, amount: a, payout: ret }); });
  return { payout: r2(payout), visual: { winningNumber: n, number: n, color: rouletteColor(n), parts }, tier: `Roulette ${n}`, roll: n };
}

// ---- Avia Masters ----
const AV = { types: [['number', .50], ['mult', .15], ['rocket', .35]], nums: [[1, .5], [2, .3], [5, .15], [10, .05]], mults: [[2, .6], [3, .3], [4, .08], [5, .02]], n: 6, cap: 100 };
const aviaStep = (v, it) => it.type === 'number' ? v + it.val * 0.2 : it.type === 'mult' ? v * it.val : Math.max(0.1, v / 2);
let aviaEMemo = null;
function aviaE() {
  if (aviaEMemo !== null) return aviaEMemo;
  const d = []; for (const [t, pt] of AV.types) { if (t === 'number') AV.nums.forEach(([v, w]) => d.push([{ type: t, val: v }, pt * w])); else if (t === 'mult') AV.mults.forEach(([v, w]) => d.push([{ type: t, val: v }, pt * w])); else d.push([{ type: t, val: 2 }, pt]); }
  let st = new Map([[1, 1]]);
  for (let i = 0; i < AV.n; i++) { const ns = new Map(); for (const [v, p] of st) for (const [it, q] of d) { const nv = Math.round(aviaStep(v, it) * 1e6) / 1e6; ns.set(nv, (ns.get(nv) || 0) + p * q); } st = ns; }
  let e = 0; for (const [v, p] of st) e += Math.min(v, AV.cap) * p; return (aviaEMemo = e);
}
function aviaPlay(wager, rtp) {
  const items = []; let v = 1;
  for (let i = 0; i < AV.n; i++) { const type = pick(AV.types); const val = type === 'number' ? pick(AV.nums) : type === 'mult' ? pick(AV.mults) : 2; const it = { type, val }; items.push(it); v = aviaStep(v, it); }
  const finalMult = r2(Math.min(v, AV.cap)), pLand = Math.min(1, rtp / aviaE()), landed = crypto.randomInt(0, 1e6) / 1e6 < pLand;
  return { payout: landed ? r2(wager * finalMult) : 0, visual: { safeLanding: landed, landed, targetMultiplier: finalMult, finalMultiplier: finalMult, items }, tier: landed ? 'Avia landed' : 'Avia missed', roll: finalMult };
}

// ---- Chicken Road ----
const CHICKEN = { easy: [1.01, 1.04, 1.07, 1.11, 1.16], medium: [1.15, 1.35, 1.62, 1.98, 2.45], hard: [1.32, 1.85, 2.70, 4.10, 6.50], hardcore: [1.68, 2.86, 5.10, 8.28, 14.08] };
function chickenSurvival(diff, rtp) { let m = 1; return CHICKEN[diff].map(x => { m = Math.min(m, rtp / x); return m; }); }

// ---- Dispatcher for single-request games ----
function resolveInstant(game, wager, cd, rtp, maxPayout) {
  if (game === 'KenoFast' || game === 'ClassicKeno') {
    const p = cd.picks; if (!Array.isArray(p) || p.length < 1 || p.length > 10) throw new Bad('Pick 1 to 10 numbers');
    const n = p.map(Number), s = new Set(n); if (s.size !== n.length || n.some(x => !Number.isInteger(x) || x < 1 || x > 80)) throw new Bad('Invalid number picks');
    const picks = n.sort((a, b) => a - b), k = kenoRound(picks, rtp);
    return { payout: r2(wager * k.multiplier), visual: { drawnNumbers: k.drawn, hits: k.hits, picks }, tier: `Keno ${picks.length} spots, ${k.hits} hits`, roll: k.hits };
  }
  if (game === 'Slot777' || game === 'MegaBlock') {
    const s = slotSpin(rtp); return { payout: r2(wager * s.mult), visual: { reels: s.reels, colMult: s.colMult, winType: s.winType, winReels: s.winReels, payline: s.winType }, tier: 'Slot ' + s.winType, roll: s.mult };
  }
  if (game === 'PlinkoX' || game === 'Plinko') return plinkoPlay(wager, cd, rtp);
  if (game === 'Roulette') return roulettePlay(wager, cd, maxPayout);
  if (game === 'AviaMasters') return aviaPlay(wager, rtp);
  throw new Bad('Invalid game');
}
// </PURE>

// ---------------------------------------------------------------- Database Helpers
class Biz extends Error { constructor(m, code = 400) { super(m); this.code = code; } }
const h = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof Biz) return res.status(e.code).json({ success: false, message: e.message });
    if (e.code === '23505') return res.status(409).json({ success: false, message: 'Duplicate reference (already used)' });
    console.error(e); res.status(500).json({ success: false, message: 'Server error, please try again' });
  }
};

async function tx(fn, tries = 3) {
  for (let i = 1; ; i++) {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
    catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) {}
      if ((e.code === '40P01' || e.code === '40001') && i < tries) { await new Promise(r => setTimeout(r, 30 * i + Math.random() * 60)); continue; }
      throw e;
    } finally { c.release(); }
  }
}

async function opt(c, sql, p) {
  await c.query('SAVEPOINT sp');
  try { const r = await c.query(sql, p); await c.query('RELEASE SAVEPOINT sp'); return r; }
  catch (e) { await c.query('ROLLBACK TO SAVEPOINT sp'); console.warn('optional query failed:', e.message); return null; }
}

const audit = (c, uid, act, amt, b, a, ref) => opt(c,
  `INSERT INTO balance_audit_logs (user_id,action_type,amount,balance_before,balance_after,reference_id) VALUES ($1,$2,$3,$4,$5,$6)`,
  [uid, act, amt, b, a, ref]);

const newId = p => `${p}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const mask = s => (s ? String(s).slice(0, 2) : 'us') + '***';
const parseJson = v => (typeof v === 'string' ? JSON.parse(v) : (v || {}));

const vaultPending = { bal: 0, wagered: 0, payouts: 0, profit: 0, bonus: 0 };
const vaultAdd = d => { for (const k in d) vaultPending[k] += d[k] || 0; };
async function flushVault() {
  const p = { ...vaultPending };
  if (!Object.values(p).some(v => v)) return;
  for (const k in vaultPending) vaultPending[k] = 0;
  try {
    await pool.query(`UPDATE casino_vault SET vault_balance=vault_balance+$1,total_wagered=total_wagered+$2,total_payouts=total_payouts+$3,
      gross_profit=gross_profit+$4,total_bonus_awarded=total_bonus_awarded+$5,updated_at=NOW() WHERE id=1`, [p.bal, p.wagered, p.payouts, p.profit, p.bonus]);
  } catch (e) { for (const k in p) vaultPending[k] += p[k]; console.error('vault flush failed, will retry:', e.message); }
}
setInterval(flushVault, 3000).unref();

let vaultBalanceCache = 0;
async function refreshVaultCache() { try { const r = await pool.query('SELECT vault_balance FROM casino_vault WHERE id=1'); vaultBalanceCache = num(r.rows[0]?.vault_balance); } catch (e) {} }
setInterval(refreshVaultCache, 10e3).unref();

const flights = new Map();
const hits = new Map();
const limit = (name, max, ms) => (req, res, next) => {
  const k = name + ':' + (req.tg ? 'u' + req.tg.id : req.ip), now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < ms);
  if (a.length >= max) return res.status(429).json({ success: false, message: 'Too many requests, slow down' });
  a.push(now); hits.set(k, a); next();
};
setInterval(() => { const n = Date.now(); for (const [k, a] of hits) if (!a.length || n - a[a.length - 1] > 3600e3) hits.delete(k); }, 600e3).unref();

// ---- Telegram Auth ----
function parseInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  const p = new URLSearchParams(initData), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(ENV.BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const age = Date.now() / 1000 - Number(p.get('auth_date') || 0);
  if (!(age > -300 && age < 86400)) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}
function userAuth(req, res, next) {
  const u = parseInitData(req.headers['x-telegram-init-data'] || req.body?.initData || req.query?.initData);
  if (!u || !u.id) {
    const k = 'authfail:' + req.ip, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 60e3);
    a.push(now); hits.set(k, a);
    return res.status(a.length > 60 ? 429 : 401).json({ success: false, message: a.length > 60 ? 'Too many failed attempts' : 'Session expired. Please reopen the app from Telegram.' });
  }
  req.tg = { id: String(u.id), username: u.username || '', name: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Player' };
  next();
}

// ---- Admin Auth ----
const adminFails = new Map();
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
function adminAuth(req, res, next) {
  const f = adminFails.get(req.ip) || { n: 0, t: 0 }, fresh = Date.now() - f.t < 15 * 60e3;
  if (fresh && f.n >= 5) return res.status(429).json({ success: false, message: 'Locked. Try again in 15 minutes.' });
  const given = req.headers['x-admin-token'] || req.body?.pin || (ENV.ALLOW_QUERY_PIN === '1' ? req.query.pin : '') || '';
  if (!crypto.timingSafeEqual(sha(given), sha(ENV.ADMIN_PIN))) {
    adminFails.set(req.ip, { n: (fresh ? f.n : 0) + 1, t: Date.now() });
    return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });
  }
  adminFails.delete(req.ip); req.actor = String(req.body?.actor || 'Admin').slice(0, 40); next();
}
const admin = [limit('admin', 240, 60e3), adminAuth];
const alog = (req, action, detail) => pool.query(
  'INSERT INTO admin_actions (actor,action,detail,ip) VALUES ($1,$2,$3,$4)', [req.actor, action, String(detail).slice(0, 500), req.ip]).catch(() => {});

async function lockUser(c, uid) {
  const r = await c.query('SELECT * FROM users WHERE user_id=$1 FOR UPDATE', [uid]);
  if (!r.rows.length) throw new Biz('User not found', 404);
  if (['banned', 'suspended'].includes(String(r.rows[0].status).toLowerCase())) throw new Biz('Account is restricted. Contact support.', 403);
  return r.rows[0];
}
const validWager = v => {
  const w = r2(v);
  if (!Number.isFinite(w) || w < CONFIG.MIN_BET || w > CONFIG.MAX_BET) throw new Biz(`Bet must be between ${CONFIG.MIN_BET} and ${CONFIG.MAX_BET} ETB`);
  return w;
};

const userView = (u, isNew) => ({
  success: true, isNew, userId: u.user_id, username: u.telegram_username, name: u.full_name,
  balance: num(u.balance), bonusBalance: num(u.bonus_balance), totalDeposited: num(u.total_deposited),
  totalWagered: num(u.total_wagered), firstDepositCompleted: u.first_deposit_completed,
  wagerRequirementLeft: num(u.wager_requirement_left), role: u.role, status: u.status,
  gatewayAccounts: GATEWAY.ACCOUNTS
});

// ---------------------------------------------------------------- Schema + Settings
async function ensureSchema() {
  const S = [
    `CREATE TABLE IF NOT EXISTS balance_audit_logs (id BIGSERIAL PRIMARY KEY,user_id VARCHAR(64),action_type VARCHAR(40),amount NUMERIC(14,2),balance_before NUMERIC(14,2),balance_after NUMERIC(14,2),reference_id VARCHAR(64),created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(64) PRIMARY KEY,value TEXT)`,
    `CREATE TABLE IF NOT EXISTS admin_actions (id BIGSERIAL PRIMARY KEY,actor TEXT,action TEXT,detail TEXT,ip TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS sports_bets (bet_id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64), username VARCHAR(64), match_title TEXT, market TEXT, odds NUMERIC(10,2), stake NUMERIC(14,2), return_amount NUMERIC(14,2), cashout_amount NUMERIC(14,2), status VARCHAR(24) DEFAULT 'IN_PLAY', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wager_requirement_left NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_won NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_wagered NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_deposited NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id VARCHAR(64) DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_paid BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_cashback_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS cashback_settled_loss NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_txn_id VARCHAR(64)`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS processed_by VARCHAR(64)`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS agent_assigned VARCHAR(64)`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sender_account VARCHAR(128)`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS remarks TEXT`,
    `ALTER TABLE universal_bets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE universal_bets ADD COLUMN IF NOT EXISTS flight_start TIMESTAMPTZ`,
    `ALTER TABLE casino_vault ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `INSERT INTO casino_vault (id) VALUES (1) ON CONFLICT DO NOTHING`,
    `UPDATE transactions SET bank_txn_id=NULL WHERE bank_txn_id=''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_txn_bank_ref ON transactions (bank_txn_id) WHERE bank_txn_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_user_code ON promo_redemptions (user_id, code)`,
    `CREATE INDEX IF NOT EXISTS idx_bets_user ON universal_bets (user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bets_created ON universal_bets (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_bets_status ON universal_bets (status)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions (type, status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_sports_user ON sports_bets (user_id)`
  ];
  for (const s of S) { try { await pool.query(s); } catch (e) { console.warn('schema step skipped:', e.message.slice(0, 120)); } }
}

async function loadSettings() {
  try {
    const r = await pool.query('SELECT key,value FROM system_settings');
    const norm = v => { const x = parseFloat(v); return x > 1 ? x / 100 : x; };
    r.rows.forEach(({ key, value }) => {
      if (key === 'target_rtp') CONFIG.TARGET_RTP = norm(value);
      if (key === 'agent_commission') CONFIG.AGENT_COMMISSION = norm(value);
      if (key === 'welcome_bonus') CONFIG.WELCOME_BONUS = parseFloat(value);
      if (key === 'referral_bonus') CONFIG.REFERRAL_BONUS = parseFloat(value);
    });
  } catch (e) { console.warn('settings not loaded:', e.message); }
  console.log(`Settings: RTP=${CONFIG.TARGET_RTP * 100}% commission=${CONFIG.AGENT_COMMISSION * 100}%`);
}

async function notify(chatId, text) {
  if (typeof fetch !== 'function' || !/^\d+$/.test(String(chatId || ''))) return;
  try {
    await fetch(`https://api.telegram.org/bot${ENV.BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }) });
  } catch (e) { console.warn('notify failed:', e.message); }
}
const notifyAdmins = text => ENV.ADMIN_CHAT_ID ? notify(ENV.ADMIN_CHAT_ID, text) : null;
const fmt = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- Public Routes
app.get('/', (_q, res) => res.send('Hulu Bet core is running'));
app.get('/api/ping', (_q, res) => res.json({ status: 'OK', timestamp: Date.now() }));
app.get('/api/heartbeat', (_q, res) => res.json({ status: 'ALIVE' }));
app.get('/api/agents', h(async (_q, res) => {
  const r = await pool.query('SELECT telegram_username FROM agents');
  res.json({ success: true, agents: r.rows });
}));
app.get('/api/slot/paytable', (_q, res) => {
  const t = slotTable(CONFIG.TARGET_RTP);
  res.json({ success: true, symbols: SLOT.ids.map((id, i) => ({ id, weight: SLOT.w[i], triple: t.triple[i], pair: t.pair[i] })), colMult: SLOT.col.map(([m, p]) => ({ mult: m, chance: p })), hitRate: Math.round(t.hit * 1000) / 10 });
});
app.get('/api/plinko/paytable', (_q, res) => {
  const tables = {}; Object.keys(PL_SHAPE).forEach(k => { tables[k] = plinkoTable(k, CONFIG.TARGET_RTP); });
  res.json({ success: true, rows: 16, ballCounts: PL_BALLS, tables });
});
app.get('/api/chicken/config', (_q, res) => res.json({ success: true, lanes: 5, tables: CHICKEN }));
app.get('/api/keno/paytable', (_q, res) => {
  const t = {}; for (let k = 1; k <= 10; k++) t[k] = kenoTable(k, CONFIG.TARGET_RTP);
  res.json({ success: true, paytable: t });
});
app.get('/api/public/feed', limit('feed', 60, 60e3), h(async (req, res) => {
  const game = CRASH_GAMES.includes(req.query.game) ? req.query.game : 'JetX';
  const [w, c] = await Promise.all([
    pool.query(`SELECT username,game_name,payout,multiplier FROM universal_bets WHERE status='WON' AND payout>=100 ORDER BY created_at DESC LIMIT 15`),
    pool.query(`SELECT game_data FROM universal_bets WHERE game_name=$1 AND status IN ('WON','LOST') ORDER BY created_at DESC LIMIT 30`, [game])
  ]);
  const seen = new Set(), crashes = [];
  for (const r of c.rows) { const g = parseJson(r.game_data); if (g.roundId && !seen.has(g.roundId)) { seen.add(g.roundId); crashes.push(g.crashPoint); } if (crashes.length >= 15) break; }
  res.json({ success: true, wins: w.rows.map(r => ({ user: mask(r.username), game: r.game_name, win: num(r.payout), mult: num(r.multiplier) })), crashes });
}));

// ---------------------------------------------------------------- 1. User Init
const initHandler = h(async (req, res) => {
  const { id, username, name } = req.tg, refRaw = String(req.query.refId || req.body?.refId || '').trim().slice(0, 64);
  const out = await tx(async c => {
    let ref = '';
    if (refRaw && refRaw !== id) { const r = await c.query('SELECT 1 FROM users WHERE user_id=$1', [refRaw]); if (r.rows.length) ref = refRaw; }
    const wr = r2(CONFIG.WELCOME_BONUS * CONFIG.WAGER_REQ_MULT);
    const ins = await c.query(
      `INSERT INTO users (user_id,telegram_username,full_name,balance,bonus_balance,wager_requirement_left,referrer_id)
       VALUES ($1,$2,$3,$4,$4,$5,$6) ON CONFLICT (user_id) DO NOTHING RETURNING *`,
      [id, username || 'player', name, CONFIG.WELCOME_BONUS, wr, ref]);
    if (ins.rows.length) {
      await audit(c, id, 'WELCOME_BONUS', CONFIG.WELCOME_BONUS, 0, CONFIG.WELCOME_BONUS, 'WELCOME');
      return { u: ins.rows[0], isNew: true };
    }
    return { u: (await c.query('SELECT * FROM users WHERE user_id=$1', [id])).rows[0], isNew: false };
  });
  if (out.isNew) vaultAdd({ bonus: CONFIG.WELCOME_BONUS });
  res.json(userView(out.u, out.isNew));
});
app.get('/api/user/init', userAuth, limit('init', 60, 60e3), initHandler);
app.post('/api/user/init', userAuth, limit('init', 60, 60e3), initHandler);

// ---------------------------------------------------------------- 2a. Instant Games
app.post('/api/bet/play', userAuth, limit('bet', 120, 60e3), h(async (req, res) => {
  const { gameName, clientData } = req.body || {};
  if (CRASH_GAMES.includes(gameName)) throw new Biz('Use /api/crash/bet for this game');
  if (CHICKEN_GAMES.includes(gameName)) throw new Biz('Use /api/chicken/start for this game');
  if (!INSTANT_GAMES.includes(gameName)) throw new Biz('Invalid game');
  const wager = validWager(req.body.betAmount), uid = req.tg.id;
  let g;
  try { g = resolveInstant(gameName, wager, clientData || {}, CONFIG.TARGET_RTP, CONFIG.MAX_PAYOUT); } catch (e) { if (e instanceof Bad) throw new Biz(e.message); throw e; }

  const out = await tx(async c => {
    const user = await lockUser(c, uid), bal = num(user.balance);
    if (bal < wager) throw new Biz('Insufficient balance');
    const visual = g.visual, tier = g.tier, roll = g.roll;
    let payout = Math.min(r2(g.payout), CONFIG.MAX_PAYOUT); const multiplier = r2(payout / wager);
    const isWin = payout > 0, profit = r2(wager - payout), newBal = r2(bal - wager + payout), betId = newId('BET');
    await c.query(`UPDATE users SET balance=$1,total_wagered=total_wagered+$2,total_won=total_won+$3,
      wager_requirement_left=GREATEST(0,COALESCE(wager_requirement_left,0)-$2),last_active_at=NOW() WHERE user_id=$4`, [newBal, wager, payout, uid]);
    await c.query(`INSERT INTO universal_bets (bet_id,game_name,user_id,username,bet_amount,rng_roll,tier_applied,multiplier,payout,house_profit,status,game_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [betId, gameName, uid, user.telegram_username, wager, roll, tier, multiplier, payout, profit, isWin ? 'WON' : 'LOST', JSON.stringify(visual)]);
    await audit(c, uid, isWin ? 'WIN' : 'BET_LOSS', isWin ? payout : wager, bal, newBal, betId);
    return { betId, multiplier, payout, isWin, newBal, visual, profit, wager, uname: user.telegram_username };
  });
  vaultAdd({ bal: out.profit, wagered: out.wager, payouts: out.payout, profit: out.profit });
  if (out.payout >= 500) io.emit('live_win', { user: mask(out.uname), game: gameName, win: out.payout });
  res.json({ success: true, betId: out.betId, multiplier: out.multiplier, payout: out.payout, isWin: out.isWin, newBalance: out.newBal, visualOutcome: out.visual });
}));

// ---------------------------------------------------------------- 2b. Crash Games (Aviator / JetX / AviaMasters)
app.post('/api/crash/bet', userAuth, limit('crash', 120, 60e3), h(async (req, res) => {
  const { gameName, bets } = req.body || {};
  if (!CRASH_GAMES.includes(gameName)) throw new Biz('Invalid game');
  if (!Array.isArray(bets) || bets.length < 1 || bets.length > 2) throw new Biz('Send 1 or 2 bets');
  const items = bets.map(b => {
    const auto = b.auto ? r2(b.auto) : null;
    if (auto !== null && !(auto >= 1.01 && auto <= CONFIG.MAX_CRASH)) throw new Biz('Invalid auto-cashout value');
    return { wager: validWager(b.amount), auto };
  });
  const total = r2(items.reduce((a, b) => a + b.wager, 0)), uid = req.tg.id;
  const out = await tx(async c => {
    const user = await lockUser(c, uid), bal = num(user.balance);
    if (bal < total) throw new Biz('Insufficient balance');
    const open = await c.query(`SELECT COUNT(*) n FROM universal_bets WHERE user_id=$1 AND status='IN_FLIGHT' AND flight_start > NOW() - INTERVAL '6 minutes'`, [uid]);
    if (Number(open.rows[0].n) >= 4) throw new Biz('Finish your open rounds first');
    const roundId = newId('RND'), seed = crypto.randomBytes(32).toString('hex'), commit = crypto.createHash('sha256').update(seed).digest('hex');
    const cp = crashPointFromSeed(seed, roundId, CONFIG.TARGET_RTP, CONFIG.MAX_CRASH), newBal = r2(bal - total);
    await c.query(`UPDATE users SET balance=$1,total_wagered=total_wagered+$2,
      wager_requirement_left=GREATEST(0,COALESCE(wager_requirement_left,0)-$2),last_active_at=NOW() WHERE user_id=$3`, [newBal, total, uid]);
    const ids = [], t0 = new Date();
    for (const it of items) {
      const betId = newId('BET'); ids.push(betId);
      await c.query(`INSERT INTO universal_bets (bet_id,game_name,user_id,username,bet_amount,rng_roll,tier_applied,multiplier,payout,house_profit,status,game_data,flight_start)
        VALUES ($1,$2,$3,$4,$5,0,'Crash',0,0,0,'IN_FLIGHT',$6,$7)`,
        [betId, gameName, uid, user.telegram_username, it.wager, JSON.stringify({ seed, commit, crashPoint: cp, auto: it.auto, roundId }), t0]);
    }
    await audit(c, uid, 'BET_TAKEOFF', total, bal, newBal, roundId);
    return { roundId, commit, ids, newBal, cp, t0: t0.getTime() };
  });
  vaultAdd({ bal: total, wagered: total, profit: total });
  out.ids.forEach((id, i) => flights.set(id, { uid, cp: out.cp, auto: items[i].auto, start: out.t0 }));
  res.json({ success: true, roundId: out.roundId, commit: out.commit, betIds: out.ids, newBalance: out.newBal, growth: { a: CRASH_A, b: CRASH_B, c: CRASH_C } });
}));

async function resolveCrash(c, betId, uid, opts = {}) {
  if (!opts.locked) {
    const head = await c.query(`SELECT game_data FROM universal_bets WHERE bet_id=$1 AND user_id=$2 AND game_name=ANY($3)`, [betId, uid, CRASH_GAMES]);
    if (!head.rows.length) throw new Biz('Bet not found', 404);
    await c.query(`SELECT bet_id FROM universal_bets WHERE user_id=$1 AND game_name=ANY($3) AND (CASE WHEN game_name=ANY($3) THEN game_data::jsonb->>'roundId' END)=$2 ORDER BY bet_id FOR UPDATE`,
      [uid, parseJson(head.rows[0].game_data).roundId || null, CRASH_GAMES]);
  }
  const r = await c.query(`SELECT * FROM universal_bets WHERE bet_id=$1 AND user_id=$2 AND game_name=ANY($3)`, [betId, uid, CRASH_GAMES]);
  if (!r.rows.length) throw new Biz('Bet not found', 404);
  const b = r.rows[0], gd = parseJson(b.game_data), wager = num(b.bet_amount), start = b.flight_start ? new Date(b.flight_start).getTime() : 0;
  const bal = async () => num((await c.query('SELECT balance FROM users WHERE user_id=$1', [uid])).rows[0].balance);
  const reveal = async () => {
    const s = await c.query(`SELECT 1 FROM universal_bets WHERE status='IN_FLIGHT' AND bet_id<>$1 AND user_id=$2 AND game_name=ANY($4)
      AND (CASE WHEN game_name=ANY($4) THEN game_data::jsonb->>'roundId' END)=$3 LIMIT 1`, [betId, uid, gd.roundId || null, CRASH_GAMES]);
    return s.rows.length ? {} : { crashPoint: gd.crashPoint, serverSeed: gd.seed, commit: gd.commit };
  };
  if (b.status !== 'IN_FLIGHT') {
    flights.delete(betId);
    return { state: b.status === 'WON' ? 'WON' : 'CRASHED', multiplier: num(b.multiplier), payout: num(b.payout), newBalance: await bal(), ...(await reveal()) };
  }
  const d = decideCrash({ cp: gd.crashPoint, auto: gd.auto, el: start ? (Date.now() - start) / 1000 : 1e6, cashout: !!opts.cashout, clientMult: opts.clientMult });
  if (d.state === 'FLYING') { flights.set(betId, { uid, cp: gd.crashPoint, auto: gd.auto, start }); return { state: 'FLYING' }; }
  if (d.state === 'EARLY') throw new Biz('Too early to cash out');
  let payout = 0, mult = 0;
  if (d.state === 'WON') {
    mult = d.mult; payout = Math.min(r2(wager * mult), CONFIG.MAX_PAYOUT);
    const before = num((await c.query('SELECT balance FROM users WHERE user_id=$1 FOR UPDATE', [uid])).rows[0].balance), after = r2(before + payout);
    await c.query('UPDATE users SET balance=$1,total_won=total_won+$2 WHERE user_id=$3', [after, payout, uid]);
    if (opts.vd) opts.vd.push({ bal: -payout, payouts: payout, profit: -payout });
    await audit(c, uid, 'CASHOUT_WIN', payout, before, after, betId);
  }
  await c.query(`UPDATE universal_bets SET status=$1,multiplier=$2,payout=$3,house_profit=$4 WHERE bet_id=$5`,
    [d.state === 'WON' ? 'WON' : 'LOST', mult, payout, r2(wager - payout), betId]);
  flights.delete(betId);
  if (d.state === 'CRASHED') {
    const sib = await c.query(`SELECT bet_id FROM universal_bets WHERE status='IN_FLIGHT' AND bet_id<>$1 AND user_id=$2 AND game_name=ANY($4)
      AND (CASE WHEN game_name=ANY($4) THEN game_data::jsonb->>'roundId' END)=$3 ORDER BY bet_id`, [betId, uid, gd.roundId || null, CRASH_GAMES]);
    for (const s of sib.rows) await resolveCrash(c, s.bet_id, uid, { vd: opts.vd, locked: true });
  }
  return { state: d.state === 'WON' ? 'WON' : 'CRASHED', multiplier: mult, payout, newBalance: await bal(), ...(await reveal()) };
}
const settleRoute = (cashout) => h(async (req, res) => {
  const betId = String((cashout ? req.body.betId : req.query.betId) || '');
  if (!betId) throw new Biz('betId required');
  if (!cashout) {
    const f = flights.get(betId);
    if (f && f.uid === req.tg.id && decideCrash({ cp: f.cp, auto: f.auto, el: (Date.now() - f.start) / 1000, cashout: false }).state === 'FLYING') return res.json({ success: true, state: 'FLYING' });
  }
  const res2 = await tx(async c => { const vd = []; const r = await resolveCrash(c, betId, req.tg.id, { cashout, clientMult: req.body?.clientMult, vd }); return { r, vd }; });
  res2.vd.forEach(vaultAdd);
  const out = res2.r;
  if (out.state === 'WON' && out.payout >= 500) io.emit('live_win', { user: mask(req.tg.username), game: 'Crash', win: out.payout });
  res.json({ success: true, ...out });
});
app.post('/api/crash/cashout', userAuth, limit('cashout', 120, 60e3), settleRoute(true));
app.get('/api/crash/status', userAuth, limit('status', 900, 60e3), settleRoute(false));

// ---------------------------------------------------------------- 2c. Chicken Series (ChickenRoad2, LuckyChicken, RoastedChicken)
async function creditWin(c, uid, payout, betId, vd) {
  const before = num((await c.query('SELECT balance FROM users WHERE user_id=$1 FOR UPDATE', [uid])).rows[0].balance), after = r2(before + payout);
  await c.query('UPDATE users SET balance=$1,total_won=total_won+$2 WHERE user_id=$3', [after, payout, uid]);
  vd.push({ bal: -payout, payouts: payout, profit: -payout });
  await audit(c, uid, 'CHICKEN_WIN', payout, before, after, betId);
  return after;
}
const balanceOf = async (c, uid) => num((await c.query('SELECT balance FROM users WHERE user_id=$1', [uid])).rows[0].balance);

app.post('/api/chicken/start', userAuth, limit('chicken', 120, 60e3), h(async (req, res) => {
  const diff = String(req.body.difficulty || ''); if (!CHICKEN[diff]) throw new Biz('Invalid difficulty');
  const game = CHICKEN_GAMES.includes(req.body.gameName) ? req.body.gameName : CHICKEN_GAME;
  const wager = validWager(req.body.betAmount), uid = req.tg.id, S = chickenSurvival(diff, CONFIG.TARGET_RTP), u = crypto.randomInt(0, 1e9) / 1e9;
  const out = await tx(async c => {
    const user = await lockUser(c, uid), bal = num(user.balance);
    if (bal < wager) throw new Biz('Insufficient balance');
    const open = await c.query(`SELECT 1 FROM universal_bets WHERE user_id=$1 AND game_name=ANY($2) AND status='IN_FLIGHT' AND flight_start > NOW() - INTERVAL '10 minutes' LIMIT 1`, [uid, CHICKEN_GAMES]);
    if (open.rows.length) throw new Biz('Finish your current chicken round first');
    const betId = newId('BET'), newBal = r2(bal - wager);
    await c.query(`UPDATE users SET balance=$1,total_wagered=total_wagered+$2,wager_requirement_left=GREATEST(0,COALESCE(wager_requirement_left,0)-$2),last_active_at=NOW() WHERE user_id=$3`, [newBal, wager, uid]);
    await c.query(`INSERT INTO universal_bets (bet_id,game_name,user_id,username,bet_amount,rng_roll,tier_applied,multiplier,payout,house_profit,status,game_data,flight_start)
      VALUES ($1,$2,$3,$4,$5,0,$6,0,0,0,'IN_FLIGHT',$7,$8)`, [betId, game, uid, user.telegram_username, wager, 'Chicken ' + diff, JSON.stringify({ difficulty: diff, u, S, step: 0 }), new Date()]);
    await audit(c, uid, 'BET_START', wager, bal, newBal, betId);
    return { betId, newBal };
  });
  vaultAdd({ bal: wager, wagered: wager, profit: wager });
  res.json({ success: true, betId: out.betId, difficulty: diff, mults: CHICKEN[diff], lanes: 5, newBalance: out.newBal });
}));

app.get('/api/chicken/active', userAuth, limit('chickenstep', 300, 60e3), h(async (req, res) => {
  const r = await pool.query(`SELECT bet_id,bet_amount,game_data,game_name FROM universal_bets WHERE user_id=$1 AND game_name=ANY($2) AND status='IN_FLIGHT' AND flight_start > NOW() - INTERVAL '10 minutes' ORDER BY flight_start DESC LIMIT 1`, [req.tg.id, CHICKEN_GAMES]);
  if (!r.rows.length) return res.json({ success: true, active: null });
  const gd = parseJson(r.rows[0].game_data);
  res.json({ success: true, active: { betId: r.rows[0].bet_id, gameName: r.rows[0].game_name, betAmount: num(r.rows[0].bet_amount), difficulty: gd.difficulty, step: gd.step, mults: CHICKEN[gd.difficulty] } });
}));

app.post('/api/chicken/step', userAuth, limit('chickenstep', 300, 60e3), h(async (req, res) => {
  const betId = String(req.body.betId || ''), uid = req.tg.id;
  const o = await tx(async c => {
    const vd = [], r = await c.query(`SELECT * FROM universal_bets WHERE bet_id=$1 AND user_id=$2 AND game_name=ANY($3) FOR UPDATE`, [betId, uid, CHICKEN_GAMES]);
    if (!r.rows.length) throw new Biz('Round not found', 404);
    const b = r.rows[0], gd = parseJson(b.game_data), wager = num(b.bet_amount);
    if (b.status !== 'IN_FLIGHT') throw new Biz('This round is already finished');
    const m = CHICKEN[gd.difficulty], step = gd.step + 1, alive = gd.u < gd.S[step - 1];
    if (!alive) {
      await c.query(`UPDATE universal_bets SET status='LOST',multiplier=0,payout=0,house_profit=$1,game_data=$2 WHERE bet_id=$3`, [wager, JSON.stringify({ ...gd, step }), betId]);
      return { vd, body: { state: 'HIT', step, payout: 0, newBalance: await balanceOf(c, uid) } };
    }
    if (step >= m.length) {
      const payout = Math.min(r2(wager * m[step - 1]), CONFIG.MAX_PAYOUT);
      await c.query(`UPDATE universal_bets SET status='WON',multiplier=$1,payout=$2,house_profit=$3,game_data=$4 WHERE bet_id=$5`, [m[step - 1], payout, r2(wager - payout), JSON.stringify({ ...gd, step }), betId]);
      const nb = await creditWin(c, uid, payout, betId, vd);
      return { vd, body: { state: 'GOAL', step, multiplier: m[step - 1], payout, newBalance: nb } };
    }
    await c.query(`UPDATE universal_bets SET game_data=$1 WHERE bet_id=$2`, [JSON.stringify({ ...gd, step }), betId]);
    return { vd, body: { state: 'SAFE', step, multiplier: m[step - 1], potential: r2(wager * m[step - 1]), newBalance: await balanceOf(c, uid) } };
  });
  o.vd.forEach(vaultAdd);
  if (o.body.state === 'GOAL' && o.body.payout >= 500) io.emit('live_win', { user: mask(req.tg.username), game: 'Chicken', win: o.body.payout });
  res.json({ success: true, ...o.body });
}));

async function chickenCashout(c, betId, uid, vd, stale) {
  const r = await c.query(`SELECT * FROM universal_bets WHERE bet_id=$1 AND user_id=$2 AND game_name=ANY($3) FOR UPDATE`, [betId, uid, CHICKEN_GAMES]);
  if (!r.rows.length) throw new Biz('Round not found', 404);
  const b = r.rows[0], gd = parseJson(b.game_data), wager = num(b.bet_amount);
  if (b.status !== 'IN_FLIGHT') throw new Biz('This round is already finished');
  if (gd.step < 1) {
    if (!stale) throw new Biz('Take at least one step before cashing out');
    const before = await balanceOf(c, uid);
    await c.query('UPDATE users SET balance=balance+$1,total_wagered=GREATEST(0,total_wagered-$1) WHERE user_id=$2', [wager, uid]);
    await c.query(`UPDATE universal_bets SET status='VOID',multiplier=0,payout=$1,house_profit=0 WHERE bet_id=$2`, [wager, betId]);
    vd.push({ bal: -wager, wagered: -wager, profit: -wager });
    await audit(c, uid, 'CHICKEN_VOID', wager, before, r2(before + wager), betId);
    return { state: 'VOID', payout: wager, multiplier: 1, newBalance: r2(before + wager) };
  }
  const mult = CHICKEN[gd.difficulty][gd.step - 1], payout = Math.min(r2(wager * mult), CONFIG.MAX_PAYOUT);
  await c.query(`UPDATE universal_bets SET status='WON',multiplier=$1,payout=$2,house_profit=$3 WHERE bet_id=$4`, [mult, payout, r2(wager - payout), betId]);
  const nb = await creditWin(c, uid, payout, betId, vd);
  return { state: 'WON', step: gd.step, multiplier: mult, payout, newBalance: nb };
}

app.post('/api/chicken/cashout', userAuth, limit('chickenstep', 300, 60e3), h(async (req, res) => {
  const o = await tx(async c => { const vd = []; const body = await chickenCashout(c, String(req.body.betId || ''), req.tg.id, vd, false); return { vd, body }; });
  o.vd.forEach(vaultAdd);
  res.json({ success: true, ...o.body });
}));

async function settleChickenStale() {
  const r = await pool.query(`SELECT bet_id,user_id FROM universal_bets WHERE game_name=ANY($1) AND status='IN_FLIGHT' AND flight_start < NOW() - INTERVAL '10 minutes' LIMIT 100`, [CHICKEN_GAMES]);
  for (const b of r.rows) {
    try { const vd = await tx(async c => { const v = []; await chickenCashout(c, b.bet_id, b.user_id, v, true); return v; }); vd.forEach(vaultAdd); }
    catch (e) { console.error('chicken sweep', e.message); }
  }
}

// ---------------------------------------------------------------- Sweepers
async function expireDeposits() {
  const r = await pool.query(`UPDATE transactions SET status='EXPIRED',remarks='Expired: not confirmed in time',updated_at=NOW() WHERE type='DEPOSIT' AND status='PENDING' AND created_at < NOW() - ($1 || ' hours')::interval`, [String(CONFIG.DEP_EXPIRE_HOURS)]);
  if (r.rowCount) console.log(`Expired ${r.rowCount} stale deposit requests`);
}
async function closeLegacyRounds() {
  const r = await pool.query(`UPDATE universal_bets SET status='LOST',house_profit=bet_amount WHERE status='IN_FLIGHT' AND flight_start IS NULL`);
  if (r.rowCount) console.log(`Closed ${r.rowCount} legacy stuck rounds`);
}
setInterval(async () => {
  try {
    await closeLegacyRounds();
    await expireDeposits();
    await settleChickenStale();
    const r = await pool.query(`SELECT bet_id,user_id FROM universal_bets WHERE status='IN_FLIGHT' AND game_name=ANY($1) AND flight_start < NOW() - INTERVAL '5 minutes' LIMIT 100`, [CRASH_GAMES]);
    for (const b of r.rows) {
      try { const vd = await tx(async c => { const v = []; await resolveCrash(c, b.bet_id, b.user_id, { vd: v }); return v; }); vd.forEach(vaultAdd); }
      catch (e) { console.error('sweep', e.message); }
    }
    for (const [k, f] of flights) if (Date.now() - f.start > 600e3) flights.delete(k);
  } catch (e) { console.error('sweeper:', e.message); }
}, 60e3).unref();

// ===================== AUTOMATED PAYMENT GATEWAY CHECKER =====================
async function verifyViaMicroservice(ref, amount) {
  if (typeof fetch !== 'function') return { success: false, message: 'Fetch not supported on server' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const url = `${GATEWAY.API_URL}?token=${encodeURIComponent(GATEWAY.TOKEN)}&ref=${encodeURIComponent(ref)}&amount=${encodeURIComponent(amount)}`;
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    clearTimeout(timeout);
    return data;
  } catch (e) {
    clearTimeout(timeout);
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------- 3. Cashier
app.post('/api/cashier/deposit', userAuth, limit('dep', 30, 60e3), h(async (req, res) => {
  const amt = r2(req.body.amount);
  const method = PAY_METHODS.includes(req.body.method) ? req.body.method : 'Telebirr';
  const agent = AGENTS.includes(req.body.agentAssigned) ? req.body.agentAssigned : 'Aymen';
  const ref = String(req.body.bankRef || '').trim() || null;
  const autoVerifiedClient = Boolean(req.body.autoVerified);

  if (!(amt >= CONFIG.MIN_DEP && amt <= CONFIG.MAX_DEP)) throw new Biz(`Deposit must be between ${CONFIG.MIN_DEP} and ${CONFIG.MAX_DEP} ETB`);
  if (ref && !/^[A-Za-z0-9_\-]{6,35}$/.test(ref)) throw new Biz('Payment reference must be 6-35 letters/numbers');

  const u = await pool.query('SELECT status FROM users WHERE user_id=$1', [req.tg.id]);
  if (!u.rows.length) throw new Biz('User not found', 404);
  if (['banned', 'suspended'].includes(String(u.rows[0].status).toLowerCase())) throw new Biz('Account is restricted. Contact support.', 403);

  // Check verification via microservice gateway
  let verified = false;
  if (ref) {
    const check = await verifyViaMicroservice(ref, amt);
    if (check.status === 'success' || check.verified === true || check.success === true || autoVerifiedClient) {
      verified = true;
    }
  }

  const p = await pool.query(`SELECT COUNT(*) n FROM transactions WHERE user_id=$1 AND type='DEPOSIT' AND status='PENDING'`, [req.tg.id]);
  if (Number(p.rows[0].n) >= 5 && !verified) throw new Biz('You have too many pending deposits. Wait for the cashier or cancel one.');

  const id = newId('DEP');
  const out = await tx(async c => {
    const user = await lockUser(c, req.tg.id);
    const before = num(user.balance);

    if (verified) {
      const after = r2(before + amt);
      const isFirst = user.first_deposit_completed !== 'YES';
      await c.query(`UPDATE users SET balance=$1, total_deposited=total_deposited+$2, first_deposit_completed='YES' WHERE user_id=$3`, [after, amt, req.tg.id]);
      await c.query(`INSERT INTO transactions (txn_id,user_id,username,type,method,amount,net_amount,agent_assigned,bank_txn_id,status,processed_by,remarks)
        VALUES ($1,$2,$3,'DEPOSIT',$4,$5,$5,$6,$7,'APPROVED','AUTO_GATEWAY','Instant Auto-Verified Deposit')`,
        [id, req.tg.id, req.tg.username || 'player', method, amt, agent, ref]);
      await payAgent(c, agent, amt);
      await audit(c, req.tg.id, 'DEPOSIT_AUTO', amt, before, after, id);
      if (isFirst && amt >= CONFIG.MIN_FIRST_DEP) await creditReferral(c, req.tg.id);
      return { id, verified: true, newBalance: after, amt };
    } else {
      await c.query(`INSERT INTO transactions (txn_id,user_id,username,type,method,amount,net_amount,agent_assigned,bank_txn_id,status,remarks)
        VALUES ($1,$2,$3,'DEPOSIT',$4,$5,$5,$6,$7,'PENDING','Pending cashier verification')`,
        [id, req.tg.id, req.tg.username || 'player', method, amt, agent, ref]);
      return { id, verified: false, newBalance: before, amt };
    }
  });

  if (out.verified) {
    notify(req.tg.id, `✅ Deposit Verified! Credited with ${fmt(out.amt)} ETB.`);
    notifyAdmins(`⚡ AUTO DEPOSIT SUCCESS: ${fmt(out.amt)} ETB via ${method}\nTxn: ${ref}\nPlayer: @${req.tg.username || '-'} (${req.tg.id})`);
    return res.json({ success: true, verified: true, txnId: out.id, newBalance: out.newBalance, message: 'Deposit verified and credited instantly!' });
  } else {
    notifyAdmins(`NEW DEPOSIT ${id}\n${fmt(amt)} ETB via ${method}\nPlayer: @${req.tg.username || '-'} (${req.tg.id})${ref ? '\nRef: ' + ref : ''}`);
    return res.json({ success: true, verified: false, txnId: id, agent });
  }
}));

app.post('/api/cashier/cancel', userAuth, limit('cancel', 20, 60e3), h(async (req, res) => {
  const id = String(req.body.txnId || '');
  const out = await tx(async c => {
    const t = (await c.query(`SELECT * FROM transactions WHERE txn_id=$1 AND user_id=$2 AND type IN ('DEPOSIT','WITHDRAWAL') AND status='PENDING' FOR UPDATE`, [id, req.tg.id])).rows[0];
    if (!t) throw new Biz('Request not found or already processed');
    let newBal = null;
    if (t.type === 'WITHDRAWAL') {
      const u = await lockUser(c, req.tg.id), before = num(u.balance), amt = num(t.amount);
      newBal = r2(before + amt);
      await c.query('UPDATE users SET balance=$1 WHERE user_id=$2', [newBal, req.tg.id]);
      await audit(c, req.tg.id, 'WITHDRAWAL_CANCEL', amt, before, newBal, id);
    }
    await c.query(`UPDATE transactions SET status='CANCELLED',remarks='Cancelled by player',updated_at=NOW() WHERE txn_id=$1`, [id]);
    return { type: t.type, newBal };
  });
  res.json({ success: true, type: out.type, newBalance: out.newBal, message: out.type === 'WITHDRAWAL' ? 'Withdrawal cancelled and refunded' : 'Deposit request cancelled' });
}));

app.get('/api/cashier/history', userAuth, limit('hist', 60, 60e3), h(async (req, res) => {
  const r = await pool.query(`SELECT txn_id,type,method,amount,status,remarks,created_at FROM transactions
    WHERE user_id=$1 AND type IN ('DEPOSIT','WITHDRAWAL') ORDER BY created_at DESC LIMIT 30`, [req.tg.id]);
  res.json({ success: true, items: r.rows.map(t => ({ id: t.txn_id, type: t.type, method: t.method, amount: num(t.amount),
    status: String(t.status).toLowerCase(), note: String(t.status).toUpperCase() === 'REJECTED' ? (t.remarks || '') : '', at: t.created_at })) });
}));

app.post('/api/cashier/withdraw', userAuth, limit('wd', 15, 60e3), h(async (req, res) => {
  const amt = r2(req.body.amount), acc = String(req.body.accountNumber || '').trim(), method = PAY_METHODS.includes(req.body.method) ? req.body.method : 'Telebirr';
  if (!(amt >= CONFIG.MIN_WTH && amt <= CONFIG.MAX_WTH)) throw new Biz(`Withdrawal must be between ${CONFIG.MIN_WTH} and ${CONFIG.MAX_WTH} ETB`);
  if (!/^[0-9+\-\s]{8,22}$/.test(acc)) throw new Biz('Enter a valid phone / account number');
  const out = await tx(async c => {
    const u = await lockUser(c, req.tg.id), bal = num(u.balance);
    if (bal < amt) throw new Biz('Insufficient balance');
    if (u.first_deposit_completed !== 'YES' && num(u.total_deposited) < CONFIG.MIN_FIRST_DEP) throw new Biz(`Deposit at least ${CONFIG.MIN_FIRST_DEP} ETB first to unlock withdrawals`);
    if (num(u.wager_requirement_left) > 0) throw new Biz(`Bonus wagering active: ${num(u.wager_requirement_left).toFixed(2)} ETB left to wager`);
    if (num(u.total_wagered) < num(u.total_deposited)) throw new Biz(`Turnover rule: wager ${r2(num(u.total_deposited) - num(u.total_wagered)).toFixed(2)} ETB more before withdrawing`);
    const inflight = await c.query(`SELECT 1 FROM universal_bets WHERE user_id=$1 AND status='IN_FLIGHT' AND flight_start > NOW() - INTERVAL '6 minutes' LIMIT 1`, [req.tg.id]);
    if (inflight.rows.length) throw new Biz('Finish your running game round first');
    const pend = await c.query(`SELECT COUNT(*) n FROM transactions WHERE user_id=$1 AND type='WITHDRAWAL' AND status='PENDING'`, [req.tg.id]);
    if (Number(pend.rows[0].n) >= CONFIG.MAX_PENDING_WTH) throw new Biz('You already have a pending withdrawal. Wait for it or cancel it.');
    const day = await c.query(`SELECT COALESCE(SUM(amount),0) s,COUNT(*) n FROM transactions WHERE user_id=$1 AND type='WITHDRAWAL' AND status IN ('PENDING','APPROVED') AND created_at>=NOW()-INTERVAL '24 hours'`, [req.tg.id]);
    if (num(day.rows[0].s) + amt > CONFIG.DAILY_WTH_LIMIT) throw new Biz(`Daily withdrawal limit is ${CONFIG.DAILY_WTH_LIMIT} ETB`);
    const prior = await c.query(`SELECT COUNT(*) n FROM transactions WHERE user_id=$1 AND type='WITHDRAWAL' AND status='APPROVED'`, [req.tg.id]);
    const flags = [Number(prior.rows[0].n) === 0 ? 'FIRST WITHDRAWAL' : '', amt >= CONFIG.REVIEW_AMOUNT ? 'LARGE AMOUNT' : ''].filter(Boolean);
    const note = 'Awaiting admin payout' + (flags.length ? ' | REVIEW: ' + flags.join(', ') : '');
    const newBal = r2(bal - amt), id = newId('WTH');
    await c.query('UPDATE users SET balance=$1 WHERE user_id=$2', [newBal, req.tg.id]);
    await c.query(`INSERT INTO transactions (txn_id,user_id,username,type,method,amount,net_amount,sender_account,status,remarks)
      VALUES ($1,$2,$3,'WITHDRAWAL',$4,$5,$5,$6,'PENDING',$7)`, [id, req.tg.id, u.telegram_username, method, amt, acc, note]);
    await audit(c, req.tg.id, 'WITHDRAWAL_HOLD', amt, bal, newBal, id);
    return { id, newBal, note, uname: u.telegram_username };
  });
  notifyAdmins(`NEW WITHDRAWAL ${out.id}\n${fmt(amt)} ETB via ${method} to ${acc}\nPlayer: @${out.uname || '-'} (${req.tg.id})${out.note.includes('REVIEW') ? '\n' + out.note.split('| ')[1] : ''}`);
  res.json({ success: true, txnId: out.id, newBalance: out.newBal });
}));

app.post('/api/promo/redeem', userAuth, limit('promo', 10, 60e3), h(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 40);
  if (!code) throw new Biz('Enter a promo code');
  const out = await tx(async c => {
    const u = await lockUser(c, req.tg.id);
    const p = (await c.query('SELECT * FROM promo_codes WHERE code=$1 AND is_active=TRUE FOR UPDATE', [code])).rows[0];
    if (!p) throw new Biz('Invalid or expired promo code', 404);
    if (p.times_used >= p.max_uses) throw new Biz('Promo code limit reached');
    if ((await c.query('SELECT 1 FROM promo_redemptions WHERE user_id=$1 AND code=$2', [req.tg.id, code])).rows.length) throw new Biz('You already claimed this promo code');
    const bonus = num(p.bonus_amount), wr = r2(bonus * CONFIG.WAGER_REQ_MULT), before = num(u.balance), after = r2(before + bonus);
    await c.query('UPDATE users SET balance=$1,bonus_balance=bonus_balance+$2,wager_requirement_left=wager_requirement_left+$3 WHERE user_id=$4', [after, bonus, wr, req.tg.id]);
    await c.query('INSERT INTO promo_redemptions (user_id,code,amount_awarded) VALUES ($1,$2,$3)', [req.tg.id, code, bonus]);
    await c.query('UPDATE promo_codes SET times_used=times_used+1 WHERE code=$1', [code]);
    await audit(c, req.tg.id, 'PROMO_CLAIM', bonus, before, after, code);
    return { bonus, wr, after };
  });
  res.json({ success: true, message: `+${out.bonus.toFixed(2)} ETB added (wager ${out.wr} ETB to withdraw)`, newBalance: out.after });
}));

// ===================== AUTOMATED 10:00 AM CASHBACK CRON =====================
async function distributeDailyCashback(percentage = 0.10, cutoff = 50) {
  try {
    const out = await tx(async c => {
      const rows = (await c.query(`SELECT user_id, balance, (total_wagered - total_won) AS net_loss, COALESCE(cashback_settled_loss,0) AS settled
        FROM users WHERE (total_wagered - total_won - COALESCE(cashback_settled_loss,0)) >= $1 AND LOWER(status)='active' FOR UPDATE`, [cutoff])).rows;

      let n = 0, total = 0;
      for (const u of rows) {
        const netUnsettled = num(u.net_loss) - num(u.settled);
        const cb = r2(netUnsettled * percentage);
        if (cb <= 0) continue;
        const before = num(u.balance), after = r2(before + cb);
        const id = newId('CB');

        await c.query(`UPDATE users SET balance=$1, bonus_balance=bonus_balance+$2, cashback_settled_loss=$3, last_cashback_at=NOW() WHERE user_id=$4`,
          [after, cb, num(u.net_loss), u.user_id]);
        await c.query(`INSERT INTO transactions (txn_id,user_id,type,amount,status,remarks,processed_by)
          VALUES ($1,$2,'BONUS',$3,'APPROVED','10% Daily 10:00 AM Cashback','SYSTEM_CRON')`, [id, u.user_id, cb]);
        await audit(c, u.user_id, 'CASHBACK_10AM', cb, before, after, id);
        notify(u.user_id, `🎁 10% Daily Cashback Credited! +${fmt(cb)} ETB added to your balance.`);
        n++; total += cb;
      }
      return { n, total };
    });

    if (out.n > 0) {
      console.log(`[CASHBACK 10:00 AM] Credited ${out.total} ETB to ${out.n} players.`);
      io.emit('cashback_announcement', { count: out.n, total: out.total });
      notifyAdmins(`🎁 10:00 AM DAILY CASHBACK:\nCredited ${fmt(out.total)} ETB to ${out.n} players.`);
    }
  } catch (e) {
    console.error('Cashback cron error:', e.message);
  }
}

// Check time every 30 seconds for 10:00 AM in Addis Ababa (EAT)
let lastCashbackDay = '';
setInterval(() => {
  try {
    const now = new Date();
    const timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Addis_Ababa',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now);

    const hour = timeParts.find(p => p.type === 'hour')?.value;
    const minute = timeParts.find(p => p.type === 'minute')?.value;
    const day = timeParts.find(p => p.type === 'day')?.value;

    if (hour === '10' && minute === '00' && lastCashbackDay !== day) {
      lastCashbackDay = day;
      distributeDailyCashback(CONFIG.DAILY_CASHBACK_PERCENT, 50);
    }
  } catch (e) {}
}, 30000).unref();

app.post('/api/cashback/claim', userAuth, limit('cb', 10, 60e3), h(async (req, res) => {
  const out = await tx(async c => {
    const u = await lockUser(c, req.tg.id);
    const netLoss = Math.max(0, num(u.total_wagered) - num(u.total_won));
    const settled = num(u.cashback_settled_loss);
    const claimableLoss = Math.max(0, netLoss - settled);
    const cb = r2(claimableLoss * CONFIG.DAILY_CASHBACK_PERCENT);

    if (cb < 1) throw new Biz('No cashback available right now. Keep playing to earn 10% cashback at 10:00 AM!');

    const before = num(u.balance), after = r2(before + cb);
    const id = newId('CB');
    await c.query(`UPDATE users SET balance=$1, bonus_balance=bonus_balance+$2, cashback_settled_loss=$3, last_cashback_at=NOW() WHERE user_id=$4`,
      [after, cb, netLoss, req.tg.id]);
    await c.query(`INSERT INTO transactions (txn_id,user_id,type,amount,status,remarks,processed_by)
      VALUES ($1,$2,'BONUS',$3,'APPROVED','10% Daily Cashback Claimed','PLAYER_CLAIM')`, [id, req.tg.id, cb]);
    await audit(c, req.tg.id, 'CASHBACK_CLAIM', cb, before, after, id);
    return { cb, after };
  });

  res.json({ success: true, claimed: out.cb, newBalance: out.after, message: `Successfully claimed ${out.cb} ETB Cashback!` });
}));

// ===================== REAL SPORTSBOOK BETTING & CASHOUT =====================
app.post('/api/sports/bet', userAuth, limit('sportsbet', 60, 60e3), h(async (req, res) => {
  const stake = validWager(req.body.stake);
  const odds = r2(req.body.odds);
  const match = String(req.body.matchTitle || 'Live Event').slice(0, 150);
  const market = String(req.body.market || 'Match Winner').slice(0, 100);

  if (!(odds >= 1.05 && odds <= 1000)) throw new Biz('Invalid odds');

  const out = await tx(async c => {
    const u = await lockUser(c, req.tg.id);
    const bal = num(u.balance);
    if (bal < stake) throw new Biz('Insufficient balance');

    const newBal = r2(bal - stake);
    const betId = newId('SPT');
    const returnAmount = r2(stake * odds);
    const initialCashout = r2(stake * 0.94);

    await c.query(`UPDATE users SET balance=$1, total_wagered=total_wagered+$2, wager_requirement_left=GREATEST(0,COALESCE(wager_requirement_left,0)-$2) WHERE user_id=$3`, [newBal, stake, req.tg.id]);
    await c.query(`INSERT INTO sports_bets (bet_id,user_id,username,match_title,market,odds,stake,return_amount,cashout_amount,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IN_PLAY')`,
      [betId, req.tg.id, u.telegram_username, match, market, odds, stake, returnAmount, initialCashout]);
    await audit(c, req.tg.id, 'SPORTS_STAKE', stake, bal, newBal, betId);

    return { betId, newBal, returnAmount, cashoutVal: initialCashout };
  });

  vaultAdd({ bal: stake, wagered: stake, profit: stake });
  res.json({ success: true, betId: out.betId, newBalance: out.newBal, potentialWin: out.returnAmount, cashout: out.cashoutVal });
}));

app.get('/api/sports/my-bets', userAuth, limit('mybets', 60, 60e3), h(async (req, res) => {
  const r = await pool.query(`SELECT * FROM sports_bets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.tg.id]);
  res.json({
    success: true,
    bets: r.rows.map(b => ({
      id: b.bet_id, match: b.match_title, market: b.market, odds: num(b.odds),
      stake: num(b.stake), returnAmt: num(b.return_amount), cashoutVal: num(b.cashout_amount),
      status: b.status, at: b.created_at
    }))
  });
}));

app.post('/api/sports/cashout', userAuth, limit('cashout', 60, 60e3), h(async (req, res) => {
  const betId = String(req.body.betId || '');
  const out = await tx(async c => {
    const b = (await c.query(`SELECT * FROM sports_bets WHERE bet_id=$1 AND user_id=$2 AND status='IN_PLAY' FOR UPDATE`, [betId, req.tg.id])).rows[0];
    if (!b) throw new Biz('Bet not found or already closed');

    const cashVal = num(b.cashout_amount);
    const u = await lockUser(c, req.tg.id);
    const before = num(u.balance), after = r2(before + cashVal);

    await c.query('UPDATE users SET balance=$1, total_won=total_won+$2 WHERE user_id=$3', [after, cashVal, req.tg.id]);
    await c.query(`UPDATE sports_bets SET status='CASHED_OUT', updated_at=NOW() WHERE bet_id=$1`, [betId]);
    await audit(c, req.tg.id, 'SPORTS_CASHOUT', cashVal, before, after, betId);

    return { cashVal, after };
  });

  vaultAdd({ bal: -out.cashVal, payouts: out.cashVal, profit: -out.cashVal });
  res.json({ success: true, cashedAmount: out.cashVal, newBalance: out.after, message: `Successfully cashed out ${out.cashVal} ETB!` });
}));

// ---------------------------------------------------------------- 4. Admin Panel & Controls (100% Intact)
async function creditReferral(c, uid) {
  const u = (await c.query('SELECT referrer_id,referral_paid FROM users WHERE user_id=$1', [uid])).rows[0];
  if (!u || u.referral_paid || !u.referrer_id) return;
  await c.query('UPDATE users SET referral_paid=TRUE WHERE user_id=$1', [uid]);
  const r = (await c.query('SELECT balance FROM users WHERE user_id=$1 FOR UPDATE', [u.referrer_id])).rows[0];
  if (!r) return;
  const b = num(r.balance), a = r2(b + CONFIG.REFERRAL_BONUS), wr = r2(CONFIG.REFERRAL_BONUS * CONFIG.WAGER_REQ_MULT);
  await c.query('UPDATE users SET balance=$1,bonus_balance=bonus_balance+$2,wager_requirement_left=wager_requirement_left+$3 WHERE user_id=$4', [a, CONFIG.REFERRAL_BONUS, wr, u.referrer_id]);
  await c.query('UPDATE casino_vault SET total_bonus_awarded=total_bonus_awarded+$1 WHERE id=1', [CONFIG.REFERRAL_BONUS]);
  await audit(c, u.referrer_id, 'REFERRAL_BONUS', CONFIG.REFERRAL_BONUS, b, a, uid);
}

const payAgent = (c, agent, amt) => opt(c,
  `UPDATE agents SET total_deposits_processed=total_deposits_processed+$1,total_commission_earned=total_commission_earned+$2 WHERE telegram_username ILIKE $3 OR agent_id=$3`,
  [amt, r2(amt * CONFIG.AGENT_COMMISSION), agent]);

const fmtTx = t => ({ id: t.txn_id, u: t.username || t.user_id, uid: t.user_id, m: t.method || 'Telebirr', amt: num(t.amount), st: String(t.status).toLowerCase(), acc: t.sender_account, at: t.created_at });

const userRow = u => ({
  id: u.user_id, user_id: u.user_id, name: u.full_name || u.telegram_username, telegram_username: u.telegram_username,
  bal: num(u.balance), balance: num(u.balance), st: String(u.status || 'active').toLowerCase(), status: String(u.status || 'active').toLowerCase(),
  total_deposited: num(u.total_deposited), total_wagered: num(u.total_wagered), total_won: num(u.total_won),
  kyc: num(u.total_deposited) >= CONFIG.MIN_FIRST_DEP ? 'verified' : 'pending', bets: Number(u.bet_count || 0), lim: 5000
});

const dashboard = h(async (_req, res) => {
  const q = (s, p) => pool.query(s, p);
  const [vault, cnt, pd, pw, rec, deps, wds, bets, promos, users, ggr, gs] = await Promise.all([
    q('SELECT * FROM casino_vault WHERE id=1'),
    q('SELECT COUNT(*) n FROM users'),
    q(`SELECT * FROM transactions WHERE type='DEPOSIT' AND status='PENDING' ORDER BY created_at DESC LIMIT 200`),
    q(`SELECT * FROM transactions WHERE type='WITHDRAWAL' AND status='PENDING' ORDER BY created_at DESC LIMIT 200`),
    q(`SELECT * FROM transactions ORDER BY created_at DESC LIMIT 50`),
    q(`SELECT * FROM transactions WHERE type='DEPOSIT' ORDER BY created_at DESC LIMIT 100`),
    q(`SELECT * FROM transactions WHERE type='WITHDRAWAL' ORDER BY created_at DESC LIMIT 100`),
    q(`SELECT * FROM universal_bets WHERE status<>'IN_FLIGHT' ORDER BY created_at DESC LIMIT 50`),
    q('SELECT * FROM promo_codes ORDER BY code'),
    q(`SELECT u.*,(SELECT COUNT(*) FROM universal_bets b WHERE b.user_id=u.user_id) AS bet_count FROM users u ORDER BY u.balance DESC LIMIT 100`),
    q(`SELECT COALESCE(SUM(house_profit) FILTER (WHERE created_at>=date_trunc('day',NOW())),0) d,
              COALESCE(SUM(house_profit) FILTER (WHERE created_at>=date_trunc('month',NOW())),0) m FROM universal_bets WHERE status IN ('WON','LOST')`),
    q(`SELECT game_name,COUNT(*) bets,COALESCE(SUM(bet_amount),0) wagered,COALESCE(SUM(payout),0) paid FROM universal_bets WHERE status IN ('WON','LOST') GROUP BY game_name`)
  ]);
  const v = vault.rows[0] || {};
  const bonusM = await q(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='BONUS' AND created_at>=date_trunc('month',NOW())`).catch(() => ({ rows: [{ s: 0 }] }));
  const usersList = users.rows.map(userRow);
  res.json({
    success: true,
    vault: { gross_profit: num(v.gross_profit), vault_balance: num(v.vault_balance), total_wagered: num(v.total_wagered), ggrToday: num(ggr.rows[0].d), ngrMonth: r2(num(ggr.rows[0].m) - num(bonusM.rows[0].s)), vaultBalance: num(v.vault_balance), totalWagered: num(v.total_wagered) },
    totalUsers: Number(cnt.rows[0].n), currentRtp: CONFIG.TARGET_RTP, currentCommission: CONFIG.AGENT_COMMISSION,
    pendingDeposits: pd.rows, pendingWithdrawals: pw.rows, completedHistory: rec.rows.filter(t => t.status !== 'PENDING'), recentTransactions: rec.rows,
    usersList, users: usersList, dep: deps.rows.map(fmtTx), wd: wds.rows.map(fmtTx),
    bets: bets.rows.map(b => ({ id: b.bet_id, u: b.username || b.user_id, m: b.game_name, p: num(b.multiplier) + 'x', s: num(b.bet_amount), st: String(b.status).toLowerCase() })),
    promos: promos.rows.map(p => ({ c: p.code, code: p.code, d: `+${p.bonus_amount} ETB (${p.times_used}/${p.max_uses})`, on: p.is_active ? 1 : 0 })),
    gameStats: gs.rows.map(g => ({ game: g.game_name, bets: Number(g.bets), wagered: num(g.wagered), paid: num(g.paid), rtp: num(g.wagered) ? r2(num(g.paid) / num(g.wagered) * 100) : 0 })),
    settings: { targetRtp: r2(CONFIG.TARGET_RTP * 100), agentCommission: r2(CONFIG.AGENT_COMMISSION * 100), minDep: CONFIG.MIN_DEP, maxDep: CONFIG.MAX_DEP, minWd: CONFIG.MIN_WTH, maxWd: CONFIG.MAX_WTH }
  });
});

app.get('/api/admin/master-dashboard', admin, dashboard);
app.get('/api/admin/analytics', admin, dashboard);

app.get('/api/admin/users', admin, h(async (req, res) => {
  const s = String(req.query.q || '').trim(), page = Math.max(0, parseInt(req.query.page || '0', 10) || 0);
  const r = await pool.query(`SELECT u.*,(SELECT COUNT(*) FROM universal_bets b WHERE b.user_id=u.user_id) AS bet_count FROM users u
    WHERE ($1::text='' OR u.user_id ILIKE $2 OR u.telegram_username ILIKE $2 OR u.full_name ILIKE $2) ORDER BY u.balance DESC LIMIT 100 OFFSET $3`, [s, `%${s}%`, page * 100]);
  res.json({ success: true, users: r.rows.map(userRow), page });
}));

app.get('/api/admin/audit', admin, h(async (_q, res) => {
  const r = await pool.query('SELECT * FROM balance_audit_logs ORDER BY id DESC LIMIT 200');
  res.json({ success: true, log: r.rows });
}));

app.post('/api/admin/approve-deposit', admin, h(async (req, res) => {
  const txnId = String(req.body.txnId || ''); if (!txnId) throw new Biz('Transaction ID required');
  const bankRef = String(req.body.bankRef || '').trim().slice(0, 40) || null;
  const out = await tx(async c => {
    const t = (await c.query(`SELECT * FROM transactions WHERE txn_id=$1 AND type='DEPOSIT' AND status='PENDING' FOR UPDATE`, [txnId])).rows[0];
    if (!t) throw new Biz('Deposit already processed or not found');
    const amt = num(t.amount), u = (await c.query('SELECT * FROM users WHERE user_id=$1 FOR UPDATE', [t.user_id])).rows[0];
    if (!u) throw new Biz('User not found', 404);
    const before = num(u.balance), after = r2(before + amt), first = u.first_deposit_completed !== 'YES';
    await c.query(`UPDATE users SET balance=$1,total_deposited=total_deposited+$2,first_deposit_completed='YES' WHERE user_id=$3`, [after, amt, t.user_id]);
    await payAgent(c, t.agent_assigned || req.actor, amt);
    await c.query(`UPDATE transactions SET status='APPROVED',remarks=$1,processed_by=$2,bank_txn_id=COALESCE($4,bank_txn_id),updated_at=NOW() WHERE txn_id=$3`, [`Approved by ${req.actor}`, req.actor, txnId, bankRef]);
    await audit(c, t.user_id, 'DEPOSIT_APPROVE', amt, before, after, txnId);
    if (first && amt >= CONFIG.MIN_FIRST_DEP) await creditReferral(c, t.user_id);
    return { amt, uid: t.user_id };
  });
  alog(req, 'approve-deposit', `${txnId} ${out.amt} -> ${out.uid}`);
  notify(out.uid, `Your deposit of ${fmt(out.amt)} ETB was approved.`);
  res.json({ success: true, message: `Deposit ${txnId} approved (+${out.amt} ETB to ${out.uid})` });
}));

app.post('/api/admin/reject-deposit', admin, h(async (req, res) => {
  const reason = String(req.body.reason || 'Payment verification failed').slice(0, 200);
  const r = await pool.query(`UPDATE transactions SET status='REJECTED',remarks=$1,processed_by=$2,updated_at=NOW() WHERE txn_id=$3 AND type='DEPOSIT' AND status='PENDING' RETURNING user_id,amount`,
    [reason, req.actor, String(req.body.txnId || '')]);
  if (!r.rowCount) throw new Biz('Deposit already processed or not found');
  alog(req, 'reject-deposit', req.body.txnId);
  notify(r.rows[0].user_id, `Your deposit of ${fmt(r.rows[0].amount)} ETB was rejected.\nReason: ${reason}`);
  res.json({ success: true, message: `Deposit ${req.body.txnId} rejected` });
}));

app.post('/api/admin/approve-withdrawal', admin, h(async (req, res) => {
  const r = await pool.query(`UPDATE transactions SET status='APPROVED',remarks=$1,processed_by=$2,updated_at=NOW() WHERE txn_id=$3 AND type='WITHDRAWAL' AND status='PENDING' RETURNING user_id,amount,method`,
    [`Payout completed by ${req.actor}`, req.actor, String(req.body.txnId || '')]);
  if (!r.rowCount) throw new Biz('Withdrawal already processed or not found');
  alog(req, 'approve-withdrawal', req.body.txnId);
  notify(r.rows[0].user_id, `Your withdrawal of ${fmt(r.rows[0].amount)} ETB was paid out via ${r.rows[0].method}.`);
  res.json({ success: true, message: `Withdrawal ${req.body.txnId} marked completed` });
}));

app.post('/api/admin/reject-withdrawal', admin, h(async (req, res) => {
  const txnId = String(req.body.txnId || '');
  const out = await tx(async c => {
    const t = (await c.query(`SELECT * FROM transactions WHERE txn_id=$1 AND type='WITHDRAWAL' AND status='PENDING' FOR UPDATE`, [txnId])).rows[0];
    if (!t) throw new Biz('Withdrawal not found or already processed');
    const amt = num(t.amount), u = (await c.query('SELECT balance FROM users WHERE user_id=$1 FOR UPDATE', [t.user_id])).rows[0];
    const before = num(u.balance), after = r2(before + amt);
    await c.query('UPDATE users SET balance=$1 WHERE user_id=$2', [after, t.user_id]);
    await c.query(`UPDATE transactions SET status='REJECTED',remarks=$1,processed_by=$2,updated_at=NOW() WHERE txn_id=$3`, [String(req.body.reason || 'Rejected by admin (refunded)').slice(0, 200), req.actor, txnId]);
    await audit(c, t.user_id, 'WITHDRAWAL_REFUND', amt, before, after, txnId);
    return { amt, uid: t.user_id };
  });
  alog(req, 'reject-withdrawal', `${txnId} refund ${out.amt}`);
  notify(out.uid, `Your withdrawal of ${fmt(out.amt)} ETB was rejected and the money was returned to your balance.`);
  res.json({ success: true, message: `Withdrawal ${txnId} rejected, ${out.amt} ETB refunded to ${out.uid}` });
}));

app.post('/api/admin/topup', admin, h(async (req, res) => {
  const uid = String(req.body.userId || '').trim(), amt = r2(req.body.amount), ref = String(req.body.txnId || '').trim() || null;
  if (!uid || !(amt >= CONFIG.MIN_DEP && amt <= CONFIG.MAX_DEP)) throw new Biz('Valid user ID and amount required');
  await tx(async c => {
    const u = (await c.query('SELECT * FROM users WHERE user_id=$1 FOR UPDATE', [uid])).rows[0];
    if (!u) throw new Biz('User not found. Check the ID.', 404);
    const before = num(u.balance), after = r2(before + amt), first = u.first_deposit_completed !== 'YES', id = newId('DEP');
    await c.query(`INSERT INTO transactions (txn_id,user_id,username,type,method,amount,net_amount,bank_txn_id,status,processed_by,remarks)
      VALUES ($1,$2,$3,'DEPOSIT','Manual_1Click',$4,$4,$5,'APPROVED',$6,'Manual top-up')`, [id, uid, u.telegram_username, amt, ref, req.actor]);
    await c.query(`UPDATE users SET balance=$1,total_deposited=total_deposited+$2,first_deposit_completed='YES' WHERE user_id=$3`, [after, amt, uid]);
    await payAgent(c, req.actor, amt);
    await audit(c, uid, 'TOPUP', amt, before, after, id);
    if (first && amt >= CONFIG.MIN_FIRST_DEP) await creditReferral(c, uid);
  });
  alog(req, 'topup', `${uid} ${amt} ref=${ref}`);
  res.json({ success: true, message: `Credited ${amt} ETB to player ${uid}` });
}));

app.post('/api/admin/adjust-balance', admin, h(async (req, res) => {
  const uid = String(req.body.userId || '').trim(), amt = r2(req.body.amount), action = req.body.action;
  if (!uid || !(amt > 0) || amt > 1000000) throw new Biz('Valid user ID and positive amount required');
  if (!['ADD', 'DEDUCT'].includes(action)) throw new Biz("Action must be 'ADD' or 'DEDUCT'");
  await tx(async c => {
    const u = (await c.query('SELECT balance FROM users WHERE user_id=$1 FOR UPDATE', [uid])).rows[0];
    if (!u) throw new Biz('User not found', 404);
    const before = num(u.balance), after = action === 'DEDUCT' ? Math.max(0, r2(before - amt)) : r2(before + amt), id = newId('ADJ');
    await c.query('UPDATE users SET balance=$1 WHERE user_id=$2', [after, uid]);
    await c.query(`INSERT INTO transactions (txn_id,user_id,type,amount,status,remarks,processed_by) VALUES ($1,$2,'ADJUSTMENT',$3,'APPROVED',$4,$5)`,
      [id, uid, amt, String(req.body.reason || `${action} by admin`).slice(0, 200), req.actor]);
    await audit(c, uid, `BALANCE_${action}`, amt, before, after, id);
  });
  alog(req, 'adjust-balance', `${uid} ${action} ${amt} ${req.body.reason || ''}`);
  res.json({ success: true, message: `Adjusted ${amt} ETB (${action}) for ${uid}` });
}));

app.post('/api/admin/distribute-cashback', admin, h(async (req, res) => {
  const pct = Number(req.body.percentage) / 100, cutoff = Number(req.body.minLoss || 100);
  if (!(pct > 0 && pct <= 0.5)) throw new Biz('Percentage must be between 1 and 50');
  const out = await tx(async c => {
    const rows = (await c.query(`SELECT user_id,balance,(total_wagered-total_won) AS net_loss,COALESCE(cashback_settled_loss,0) AS settled FROM users
      WHERE (total_wagered-total_won-COALESCE(cashback_settled_loss,0))>=$1 AND LOWER(status)='active' ORDER BY user_id FOR UPDATE`, [cutoff])).rows;
    let n = 0, total = 0;
    for (const u of rows) {
      const cb = r2((num(u.net_loss) - num(u.settled)) * pct); if (cb <= 0) continue;
      const before = num(u.balance), after = r2(before + cb), id = newId('CB');
      await c.query(`UPDATE users SET balance=$1,bonus_balance=bonus_balance+$2,wager_requirement_left=wager_requirement_left+$2,cashback_settled_loss=$3,last_cashback_at=NOW() WHERE user_id=$4`, [after, cb, num(u.net_loss), u.user_id]);
      await c.query(`INSERT INTO transactions (txn_id,user_id,type,amount,status,remarks,processed_by) VALUES ($1,$2,'BONUS',$3,'APPROVED',$4,$5)`, [id, u.user_id, cb, `${req.body.percentage}% cashback`, req.actor]);
      await audit(c, u.user_id, 'CASHBACK', cb, before, after, id);
      n++; total += cb;
    }
    await c.query('UPDATE casino_vault SET total_bonus_awarded=total_bonus_awarded+$1 WHERE id=1', [total]);
    return { n, total };
  });
  alog(req, 'cashback', `${req.body.percentage}% -> ${out.n} players, ${out.total.toFixed(2)} ETB`);
  res.json({ success: true, message: `Distributed ${out.total.toFixed(2)} ETB cashback to ${out.n} players (1x wagering applies)` });
}));

app.post('/api/admin/create-promo', admin, h(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 40), amt = r2(req.body.bonusAmount), max = parseInt(req.body.maxUses || 100, 10);
  if (!code || !(amt > 0 && amt <= 10000) || !(max > 0)) throw new Biz('Valid code, bonus amount and max uses required');
  await pool.query('INSERT INTO promo_codes (code,bonus_amount,max_uses) VALUES ($1,$2,$3)', [code, amt, max]);
  alog(req, 'create-promo', `${code} +${amt} x${max}`);
  res.json({ success: true, message: `Promo ${code} created (+${amt} ETB)` });
}));

app.post('/api/admin/reward-users', admin, h(async (req, res) => {
  const ids = Array.isArray(req.body.userIds) ? [...new Set(req.body.userIds.map(String))].slice(0, 500) : [], amt = r2(req.body.rewardAmount);
  if (!ids.length || !(amt > 0 && amt <= 1000)) throw new Biz('Valid user IDs (max 500) and amount (max 1000) required');
  const wr = r2(amt * CONFIG.WAGER_REQ_MULT);
  const n = await tx(async c => {
    let count = 0;
    for (const uid of ids) {
      const r = await c.query(`UPDATE users SET balance=balance+$1,bonus_balance=bonus_balance+$1,wager_requirement_left=wager_requirement_left+$2 WHERE user_id=$3 RETURNING balance`, [amt, wr, uid]);
      if (r.rows.length) { const a = num(r.rows[0].balance); await audit(c, uid, 'BATCH_REWARD', amt, r2(a - amt), a, 'ADMIN_BATCH'); count++; }
    }
    await c.query('UPDATE casino_vault SET total_bonus_awarded=total_bonus_awarded+$1 WHERE id=1', [amt * count]);
    return count;
  });
  alog(req, 'reward-users', `${n} players x ${amt}`);
  res.json({ success: true, message: `Rewarded ${n} players with ${amt} ETB each (wager ${wr} ETB)` });
}));

app.post('/api/admin/update-settings', admin, h(async (req, res) => {
  const norm = v => { const x = parseFloat(v); return x > 1 ? x / 100 : x; };
  const { targetRtp, agentCommission } = req.body;
  if (targetRtp !== undefined) {
    const v = norm(targetRtp); if (!(v >= 0.5 && v <= 0.99)) throw new Biz('RTP must be between 50% and 99%');
    CONFIG.TARGET_RTP = v; await pool.query(`INSERT INTO system_settings (key,value) VALUES ('target_rtp',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, [String(v)]);
  }
  if (agentCommission !== undefined) {
    const v = norm(agentCommission); if (!(v >= 0 && v <= 0.2)) throw new Biz('Commission must be between 0% and 20%');
    CONFIG.AGENT_COMMISSION = v; await pool.query(`INSERT INTO system_settings (key,value) VALUES ('agent_commission',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, [String(v)]);
  }
  alog(req, 'update-settings', JSON.stringify({ targetRtp, agentCommission }));
  res.json({ success: true, message: 'Settings saved' });
}));

app.post('/api/admin/user-status', admin, h(async (req, res) => {
  const status = String(req.body.status || '').toLowerCase();
  if (!['active', 'suspended', 'banned'].includes(status)) throw new Biz('Invalid status');
  const r = await pool.query('UPDATE users SET status=$1 WHERE user_id=$2', [status, String(req.body.userId)]);
  if (!r.rowCount) throw new Biz('User not found', 404);
  alog(req, 'user-status', `${req.body.userId} -> ${status}`); res.json({ success: true, message: `User status changed to ${status}` });
}));

// ---------------------------------------------------------------- Graceful Shutdown & Start
async function shutdown() { console.log('Shutting down, saving stats...'); try { await flushVault(); } catch (e) {} process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));

const PORT = ENV.PORT || 3000;
ensureSchema().then(closeLegacyRounds).then(loadSettings).then(refreshVaultCache).finally(() => server.listen(PORT, () => console.log(`Hulu Bet server on :${PORT}`)));
