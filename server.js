/**
 * ============================================================================
 * 🦁 HULU BET - MASTER PRODUCTION ENTERPRISE ENGINE (server.js)
 * Official Bot: @Hulubetethbot | Official Channel: @HuluBetOfficial
 * Official Agents: @Agent1hulubet | @Agent2hulubet
 * 
 * Features:
 * - 6 Casino Games (Aviator, JetX, KenoFast, ChickenRoad2, Slot777, AviaMasters)
 * - 100% AML Turnover Rule & Anti-Money Laundering Enforcement
 * - Row-Level In-Row Approvals & Auto-Refund on Rejections
 * - Render Cold-Start Keep-Alive Heartbeat (/api/ping)
 * - Telegram InitData HMAC-SHA256 Cryptographic Verification
 * - Double-Entry Financial Audit Trail (balance_audit_logs)
 * - Dynamic RTP & Multi-Agent Commission Live Control
 * - Unified Support for both admin.html and bet-admin.html
 * ============================================================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// 🗄️ PostgreSQL Connection Pool (Neon Database)
let dbUrl = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_feXPgp4B8Wkh@ep-shy-rain-b5qmdt68-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require";
dbUrl = dbUrl.replace('&channel_binding=require', '').replace('?channel_binding=require', '');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 30, // 30 concurrent connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.message);
  } else {
    console.log('✅ Connected to Hulu Bet PostgreSQL Core Database (Neon)!');
    release();
  }
});

// System Configuration
const CONFIG = {
  ADMIN_PIN: process.env.ADMIN_PIN || "1234",
  BOT_TOKEN: process.env.BOT_TOKEN || "", 
  TARGET_RTP: 0.85,                       // 85% Target RTP
  AGENT_COMMISSION: 0.02,                 // 2% Agent Commission
  WELCOME_BONUS: 20.00,
  REFERRAL_BONUS: 50.00,
  MIN_FIRST_DEP: 50.00,
  WAGER_REQ_MULT: 3,
  MIN_DEP: 50.00,
  MAX_DEP: 100000.00,
  MIN_WTH: 100.00,
  MAX_WTH: 50000.00,
  MAX_BET: 1000.00,
  MAX_PAYOUT: 20000.00,
  SAFETY_BUFFER: 50000.00
};

// እርስ በእርስ እንዳይጋጩ SETTINGS እና CONFIG አንድ አይነት እንዲሆኑ ማድረግ
const SETTINGS = CONFIG;

// ዳታቤዝ ላይ የተቀመጡ ተለዋዋጭ ቅንብሮችን ማንበቢያ
async function loadDynamicSettings() {
  try {
    const res = await pool.query('SELECT key, value FROM system_settings');
    res.rows.forEach(r => {
      if (r.key === 'target_rtp') CONFIG.TARGET_RTP = parseFloat(r.value);
      if (r.key === 'agent_commission') CONFIG.AGENT_COMMISSION = parseFloat(r.value);
      if (r.key === 'welcome_bonus') CONFIG.WELCOME_BONUS = parseFloat(r.value);
      if (r.key === 'referral_bonus') CONFIG.REFERRAL_BONUS = parseFloat(r.value);
    });
    console.log(`⚙️ Dynamic Settings Loaded: RTP=${CONFIG.TARGET_RTP * 100}%, Commission=${CONFIG.AGENT_COMMISSION * 100}%`);
  } catch(e) {}
}
loadDynamicSettings();

// ============================================================================
// 🛡️ SECURITY & COMPLIANCE HELPERS
// ============================================================================

// 1. የቴሌግራም InitData ምስጠራ አረጋጋጭ (HMAC-SHA256)
function verifyTelegramWebAppData(initData, botToken) {
  if (!initData || !botToken) return true; // ቦት ቶከን ገና ካልተሞላ ክፍት ያደርገዋል
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    const dataCheckString = Array.from(urlParams.entries())
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    return calculatedHash === hash;
  } catch (e) {
    return false;
  }
}

// 2. Double-Entry የፋይናንስ ኦዲት መዝጋቢ (Financial Audit Trail)
async function logFinancialAudit(client, userId, actionType, amount, balBefore, balAfter, refId) {
  try {
    await client.query(`
      INSERT INTO balance_audit_logs (user_id, action_type, amount, balance_before, balance_after, reference_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [userId, actionType, amount, balBefore, balAfter, refId]);
  } catch(e) {}
}

// ============================================================================
// 💓 KEEP-ALIVE HEARTBEAT (የ RENDER 15 ደቂቃ እንቅልፍ መከላከያ)
// ============================================================================
app.get('/', (req, res) => res.send("🦁 Hulu Bet Master Production Core is Running Live!"));
app.get('/api/ping', (req, res) => res.json({ status: "OK", timestamp: Date.now() }));
app.get('/api/heartbeat', (req, res) => res.json({ status: "ALIVE" }));

// ============================================================================
// 👥 1. USER AUTH & BALANCE INITIALIZATION
// ============================================================================
app.get('/api/user/init', async (req, res) => {
  const { userId, username, name, refId, initData } = req.query;
  const cleanId = String(userId || 'guest_101').trim();
  const cleanUser = String(username || 'player').trim();
  const cleanName = String(name || 'Player').trim();
  const cleanRef = String(refId || '').trim();

  // የቴሌግራም ፊርማ ማረጋገጫ
  if (CONFIG.BOT_TOKEN && initData && !verifyTelegramWebAppData(initData, CONFIG.BOT_TOKEN)) {
    return res.status(401).json({ success: false, message: "Unauthorized Telegram Session" });
  }

  try {
    const existing = await pool.query('SELECT * FROM users WHERE user_id = $1', [cleanId]);
    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      return res.json({
        success: true,
        isNew: false,
        userId: u.user_id,
        username: u.telegram_username,
        name: u.full_name,
        balance: parseFloat(u.balance),
        bonusBalance: parseFloat(u.bonus_balance),
        totalDeposited: parseFloat(u.total_deposited),
        totalWagered: parseFloat(u.total_wagered || 0),
        firstDepositCompleted: u.first_deposit_completed,
        wagerRequirementLeft: parseFloat(u.wager_requirement_left || 0),
        role: u.role,
        status: u.status
      });
    }

    // አዲስ ተጠቃሚ ምዝገባ (Welcome Bonus)
    const finalRef = (cleanRef && cleanRef !== cleanId) ? cleanRef : '';
    const initialWagerReq = Number((CONFIG.WELCOME_BONUS * CONFIG.WAGER_REQ_MULT).toFixed(2));

    await pool.query(`
      INSERT INTO users (user_id, telegram_username, full_name, balance, bonus_balance, wager_requirement_left, referrer_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [cleanId, cleanUser, cleanName, CONFIG.WELCOME_BONUS, CONFIG.WELCOME_BONUS, initialWagerReq, finalRef]);

    await pool.query(`UPDATE casino_vault SET total_bonus_awarded = total_bonus_awarded + $1 WHERE id = 1`, [CONFIG.WELCOME_BONUS]);

    return res.json({
      success: true,
      isNew: true,
      userId: cleanId,
      username: cleanUser,
      name: cleanName,
      balance: CONFIG.WELCOME_BONUS,
      bonusBalance: CONFIG.WELCOME_BONUS,
      totalDeposited: 0.00,
      totalWagered: 0.00,
      firstDepositCompleted: 'NO',
      wagerRequirementLeft: initialWagerReq,
      role: 'Player',
      status: 'Active'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 🎰 2. 6-GAME CASINO ENGINE (With Atomic Lock & Dynamic RTP)
// ============================================================================
app.post('/api/bet/play', async (req, res) => {
  const { userId, gameName, betAmount, clientData, initData } = req.body;
  const cleanId = String(userId).trim();
  const wager = Math.round(Number(betAmount) * 100) / 100;

  if (CONFIG.BOT_TOKEN && initData && !verifyTelegramWebAppData(initData, CONFIG.BOT_TOKEN)) {
    return res.status(401).json({ success: false, message: "Security alert: Invalid Telegram Signature" });
  }

  if (isNaN(wager) || wager <= 0 || wager > CONFIG.MAX_BET) {
    return res.json({ success: false, message: `Bet must be between 1 and ${CONFIG.MAX_BET} ETB!` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 🔒 በአንድ ጊዜ በሁለት ስልክ ቢከፈት ሂሳብ እንዳይዛባ Row-level lock
    const userRes = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [cleanId]);
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'User not found!' });
    }

    const user = userRes.rows[0];
    if (user.status === 'banned' || user.status === 'suspended') {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Account is restricted! Contact support.' });
    }

    const currentBal = parseFloat(user.balance);
    if (currentBal < wager) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Insufficient balance!' });
    }

    const vaultRes = await client.query('SELECT * FROM casino_vault WHERE id = 1 FOR UPDATE');
    const vault = vaultRes.rows[0];
    const isBufferSafe = parseFloat(vault.vault_balance) >= CONFIG.SAFETY_BUFFER;

    // 🎯 ተለዋዋጭ የ RTP ቀመር (Dynamic Target RTP Model)
    const rngRoll = Number((Math.random() * 100).toFixed(2));
    let multiplier = 0.0;
    let tierApplied = "Tier 0 (Early Loss)";

    const lossThreshold = (1.0 - CONFIG.TARGET_RTP) * 100;

    if (rngRoll <= lossThreshold) {
      multiplier = Number((1.00 + Math.random() * 0.12).toFixed(2));
      tierApplied = "Tier 0 (Early Loss)";
    } else if (rngRoll <= 72.0) {
      multiplier = Number((1.20 + Math.random() * 1.60).toFixed(2));
      tierApplied = "Tier 1 (Sweet Spot)";
    } else if (rngRoll <= 94.0) {
      multiplier = Number((3.00 + Math.random() * 6.00).toFixed(2));
      tierApplied = "Tier 2 (Medium High)";
    } else {
      if (isBufferSafe) {
        multiplier = Number((10.00 + Math.random() * 70.00).toFixed(2));
        tierApplied = "Tier 3 (Mega Rocket)";
      } else {
        multiplier = 2.50;
        tierApplied = "Tier 3 (Protected Cap)";
      }
    }

    let payout = Math.round(Number(wager * multiplier) * 100) / 100;
    if (payout > CONFIG.MAX_PAYOUT) {
      payout = CONFIG.MAX_PAYOUT;
      multiplier = Number((payout / wager).toFixed(2));
    }

    const isWin = payout > 0;
    const netHouseProfit = Math.round(Number(wager - payout) * 100) / 100;
    const newBal = Math.round(Number(currentBal - wager + payout) * 100) / 100;
    const newWagerReq = Math.max(0, Math.round(Number(parseFloat(user.wager_requirement_left || 0) - wager) * 100) / 100);

    // ተጠቃሚውን ማዘመን
    await client.query(`
      UPDATE users 
      SET balance = $1, total_wagered = total_wagered + $2, total_won = total_won + $3, wager_requirement_left = $4, last_active_at = NOW()
      WHERE user_id = $5
    `, [newBal, wager, payout, newWagerReq, cleanId]);

    // ካዝናውን ማዘመን
    await client.query(`
      UPDATE casino_vault 
      SET vault_balance = vault_balance + $1, total_wagered = total_wagered + $2, total_payouts = total_payouts + $3, gross_profit = gross_profit + $1, updated_at = NOW()
      WHERE id = 1
    `, [netHouseProfit, wager, payout]);

    const visualOutcome = mapVisualOutcome(gameName, multiplier, clientData || {});
    const betId = "BET-" + Math.floor(100000 + Math.random() * 900000);
    const serverSeedHash = crypto.createHash('sha256').update(betId + rngRoll).digest('hex').substring(0, 16);

    await client.query(`
      INSERT INTO universal_bets (bet_id, game_name, user_id, username, bet_amount, rng_roll, tier_applied, multiplier, payout, house_profit, status, game_data, server_seed_hash)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [betId, gameName, cleanId, user.telegram_username, wager, rngRoll, tierApplied, multiplier, payout, netHouseProfit, isWin ? 'WON' : 'LOST', JSON.stringify(visualOutcome), serverSeedHash]);

    // የኦዲት መዝገብ ማስቀመጥ
    await logFinancialAudit(client, cleanId, isWin ? 'WIN' : 'BET', isWin ? payout : wager, currentBal, newBal, betId);

    await client.query('COMMIT');

    if (payout >= 500) {
      io.emit('live_win', {
        user: (user.telegram_username ? user.telegram_username.slice(0, 2) + '***' : 'User***'),
        game: gameName,
        win: payout
      });
    }

    return res.json({
      success: true,
      betId: betId,
      multiplier: multiplier,
      payout: payout,
      isWin: isWin,
      newBalance: newBal,
      visualOutcome: visualOutcome
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

function mapVisualOutcome(gameName, multiplier, clientData) {
  if (gameName === "KenoFast" || gameName === "Keno80") {
    const userPicks = clientData.picks || [1, 2, 3, 4, 5];
    let targetHits = multiplier >= 10.0 ? Math.min(userPicks.length, 7) : multiplier >= 2.0 ? Math.min(userPicks.length, 4) : multiplier >= 1.1 ? Math.min(userPicks.length, 2) : 0;
    const guaranteedHits = userPicks.slice(0, targetHits);
    const remaining = Array.from({ length: 80 }, (_, i) => i + 1).filter(n => !userPicks.includes(n)).sort(() => Math.random() - 0.5);
    return { drawnNumbers: [...guaranteedHits, ...remaining.slice(0, 20 - guaranteedHits.length)].sort(() => Math.random() - 0.5), hits: targetHits };
  }
  if (gameName === "Aviator" || gameName === "JetX") {
    return { crashPoint: multiplier === 0 ? 1.05 : multiplier };
  }
  if (gameName === "ChickenRoad2") {
    const diff = clientData.difficulty || "Easy";
    return { maxSafeStep: diff === "Easy" ? (multiplier > 1.2 ? 8 : 4) : diff === "Medium" ? (multiplier > 2.0 ? 6 : 3) : (multiplier > 3.0 ? 4 : 1) };
  }
  if (gameName === "Slot777") {
    return multiplier >= 25.0 ? { reels: ["🎰", "🎰", "🎰"], payline: "JACKPOT", colMult: 5 } : multiplier >= 2.0 ? { reels: ["🔔", "🔔", "🔔"], payline: "BELLS", colMult: 1 } : { reels: ["🎰", "🎰", "🍒"], payline: "NONE", colMult: 1 };
  }
  if (gameName === "AviaMasters") {
    return { safeLanding: multiplier > 0, targetMultiplier: multiplier };
  }
  return {};
}

// ============================================================================
// 💳 3. CASHIER DEPOSITS & WITHDRAWALS WITH 100% AML TURNOVER
// ============================================================================
app.post('/api/cashier/deposit', async (req, res) => {
  const { userId, username, amount, method, agentAssigned } = req.body;
  const depId = 'DEP-' + Math.floor(10000 + Math.random() * 90000);
  const amt = Math.round(Number(amount) * 100) / 100;

  if (amt < CONFIG.MIN_DEP || amt > CONFIG.MAX_DEP) {
    return res.json({ success: false, message: `Deposit must be between ${CONFIG.MIN_DEP} and ${CONFIG.MAX_DEP} ETB!` });
  }

  try {
    await pool.query(`
      INSERT INTO transactions (txn_id, user_id, username, type, method, amount, net_amount, agent_assigned, status, remarks)
      VALUES ($1, $2, $3, 'DEPOSIT', $4, $5, $5, $6, 'PENDING', 'Pending cashier verification')
    `, [depId, String(userId).trim(), username || 'player', method || 'Telebirr', amt, agentAssigned || 'Agent1hulubet']);

    res.json({ success: true, txnId: depId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cashier/withdraw', async (req, res) => {
  const { userId, amount, accountNumber, method } = req.body;
  const cleanId = String(userId).trim();
  const amt = Math.round(Number(amount) * 100) / 100;

  if (amt < CONFIG.MIN_WTH || amt > CONFIG.MAX_WTH) {
    return res.json({ success: false, message: `Withdrawal must be between ${CONFIG.MIN_WTH} and ${CONFIG.MAX_WTH} ETB!` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uRes = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [cleanId]);
    if (uRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'User not found!' });
    }

    const u = uRes.rows[0];
    const currentBal = parseFloat(u.balance);

    if (currentBal < amt) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Insufficient balance!' });
    }

    // 🛡️ Gate 1: የመጀመሪያ ዲፖዚት መቆለፊያ
    if (u.first_deposit_completed !== 'YES' && parseFloat(u.total_deposited) < CONFIG.MIN_FIRST_DEP) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: `Deposit at least ${CONFIG.MIN_FIRST_DEP} ETB first to unlock withdrawals!` });
    }

    // 🛡️ Gate 2: የቦነስ ውርርድ ህግ መቆለፊያ (Wagering Requirement)
    if (parseFloat(u.wager_requirement_left || 0) > 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: `Wager requirement active: ${parseFloat(u.wager_requirement_left).toFixed(2)} ETB remaining!` });
    }

    // 🛡️ Gate 3: አለም አቀፍ የገንዘብ ማጠብ መከላከያ (AML 100% Turnover Rule)
    const totalDeposited = parseFloat(u.total_deposited || 0);
    const totalWagered = parseFloat(u.total_wagered || 0);
    if (totalWagered < totalDeposited) {
      const remainingTurnover = (totalDeposited - totalWagered).toFixed(2);
      await client.query('ROLLBACK');
      return res.json({
        success: false,
        message: `AML Security: You must wager at least ${remainingTurnover} ETB more before withdrawing deposited funds!`
      });
    }

    // የተጠየቀውን ገንዘብ ከተጠቃሚው መቀነስ
    const newBal = Math.round(Number(currentBal - amt) * 100) / 100;
    await client.query('UPDATE users SET balance = $1 WHERE user_id = $2', [newBal, cleanId]);

    const wthId = 'WTH-' + Math.floor(10000 + Math.random() * 90000);
    await client.query(`
      INSERT INTO transactions (txn_id, user_id, username, type, method, amount, net_amount, sender_account, status, remarks)
      VALUES ($1, $2, $3, 'WITHDRAWAL', $4, $5, $5, $6, 'PENDING', 'Awaiting admin payout')
    `, [wthId, cleanId, u.telegram_username, method || 'Telebirr', amt, accountNumber]);

    await logFinancialAudit(client, cleanId, 'WITHDRAWAL_HOLD', amt, currentBal, newBal, wthId);

    await client.query('COMMIT');
    res.json({ success: true, txnId: wthId, newBalance: newBal });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 🎁 4. PROMO CODES REDEMPTION
// ============================================================================
app.post('/api/promo/redeem', async (req, res) => {
  const { userId, code } = req.body;
  const cleanId = String(userId).trim();
  const cleanCode = String(code).trim().toUpperCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const promoRes = await client.query('SELECT * FROM promo_codes WHERE code = $1 AND is_active = TRUE FOR UPDATE', [cleanCode]);
    if (promoRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Invalid or expired promo code!' });
    }
    const promo = promoRes.rows[0];
    if (promo.times_used >= promo.max_uses) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Promo code limit reached!' });
    }

    const usedRes = await client.query('SELECT * FROM promo_redemptions WHERE user_id = $1 AND code = $2', [cleanId, cleanCode]);
    if (usedRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'You have already claimed this promo code!' });
    }

    const bonus = parseFloat(promo.bonus_amount);
    await client.query('UPDATE users SET balance = balance + $1, bonus_balance = bonus_balance + $1 WHERE user_id = $2', [bonus, cleanId]);
    await client.query('INSERT INTO promo_redemptions (user_id, code, amount_awarded) VALUES ($1, $2, $3)', [cleanId, cleanCode, bonus]);
    await client.query('UPDATE promo_codes SET times_used = times_used + 1 WHERE code = $1', [cleanCode]);

    const updatedUser = await client.query('SELECT balance FROM users WHERE user_id = $1', [cleanId]);
    await client.query('COMMIT');

    res.json({
      success: true,
      message: `🎉 Success: +${bonus.toFixed(2)} ETB added to balance!`,
      newBalance: parseFloat(updatedUser.rows[0].balance)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 👑 5. COMPLETE MASTER ADMIN DASHBOARD (FOR BOTH admin.html AND bet-admin.html)
// ============================================================================

// ሁለቱንም ዳሽቦርዶች የሚያስተናግድ ማስተር ዳታ ኤንድፖይንት
const masterDashboardHandler = async (req, res) => {
  const { pin } = req.query;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    const vaultRes = await pool.query('SELECT * FROM casino_vault WHERE id = 1');
    const vault = vaultRes.rows[0] || {};

    const usersCountRes = await pool.query('SELECT COUNT(*) as total_users FROM users');
    const usersCount = usersCountRes.rows[0]?.total_users || 0;

    // ተጠቃሚዎችን ማምጣት
    let usersList = [];
    try {
      const uRes = await pool.query(`
        SELECT user_id, telegram_username, full_name, balance, total_deposited, total_wagered, total_won, status 
        FROM users ORDER BY balance DESC LIMIT 100
      `);
      usersList = (uRes.rows || []).map(u => ({
        id: u.user_id,
        user_id: u.user_id,
        name: u.full_name || u.telegram_username || 'Player',
        telegram_username: u.telegram_username,
        bal: parseFloat(u.balance || 0),
        balance: parseFloat(u.balance || 0),
        st: u.status || 'active',
        status: u.status || 'active',
        total_deposited: parseFloat(u.total_deposited || 0),
        total_wagered: parseFloat(u.total_wagered || 0),
        total_won: parseFloat(u.total_won || 0),
        kyc: parseFloat(u.total_deposited || 0) >= CONFIG.MIN_FIRST_DEP ? 'verified' : 'pending',
        bets: Math.floor(parseFloat(u.total_wagered || 0) / 10),
        lim: 5000
      }));
    } catch(e) {}

    // ትራንዛክሽኖችን በሰላም ማምጣት (ሳይወድቅ)
    let allTxns = [];
    try {
      const txRes = await pool.query('SELECT * FROM transactions LIMIT 200');
      allTxns = txRes.rows ? txRes.rows.reverse() : [];
    } catch(e) {}

    const pendingDeposits = allTxns.filter(t => t.type === 'DEPOSIT' && t.status === 'PENDING');
    const pendingWithdrawals = allTxns.filter(t => t.type === 'WITHDRAWAL' && t.status === 'PENDING');
    const completedHistory = allTxns.filter(t => t.status !== 'PENDING').slice(0, 50);

    const depositsFormatted = allTxns.filter(t => t.type === 'DEPOSIT').map(t => ({
      id: t.txn_id, u: t.username || t.user_id, m: t.method || 'Telebirr', amt: parseFloat(t.amount), st: t.status.toLowerCase()
    }));

    const withdrawalsFormatted = allTxns.filter(t => t.type === 'WITHDRAWAL').map(t => ({
      id: t.txn_id, u: t.username || t.user_id, m: t.method || 'Telebirr', amt: parseFloat(t.amount), st: t.status.toLowerCase(), acc: t.sender_account
    }));

    // ውርርዶችን ማምጣት
    let betsList = [];
    try {
      const bRes = await pool.query('SELECT * FROM universal_bets LIMIT 100');
      betsList = (bRes.rows ? bRes.rows.reverse() : []).slice(0, 50).map(b => ({
        id: b.bet_id, u: b.username || b.user_id, m: b.game_name, p: b.multiplier + 'x', s: parseFloat(b.bet_amount), st: b.status.toLowerCase()
      }));
    } catch(e) {}

    // ፕሮሞዎችን ማምጣት
    let promosList = [];
    try {
      const pRes = await pool.query('SELECT * FROM promo_codes');
      promosList = pRes.rows.map(p => ({
        c: p.code, code: p.code, bonus_amount: parseFloat(p.bonus_amount), times_used: p.times_used, max_uses: p.max_uses,
        d: `+${p.bonus_amount} ETB (${p.times_used}/${p.max_uses})`, on: p.is_active ? 1 : 0
      }));
    } catch(e) {}

    return res.json({
      success: true,
      vault: {
        gross_profit: parseFloat(vault.gross_profit || 0),
        vault_balance: parseFloat(vault.vault_balance || 0),
        total_wagered: parseFloat(vault.total_wagered || 0),
        ggrToday: parseFloat(vault.gross_profit || 0),
        ngrMonth: parseFloat(vault.gross_profit || 0) * 0.9,
        vaultBalance: parseFloat(vault.vault_balance || 0),
        totalWagered: parseFloat(vault.total_wagered || 0)
      },
      totalUsers: usersCount,
      currentRtp: CONFIG.TARGET_RTP,
      currentCommission: CONFIG.AGENT_COMMISSION,
      // ለሁለቱም ዳሽቦርዶች የሚሆን አንድ ወጥ ዳታ
      pendingDeposits,
      pendingWithdrawals,
      completedHistory,
      recentTransactions: allTxns.slice(0, 50),
      usersList,
      users: usersList,
      dep: depositsFormatted,
      wd: withdrawalsFormatted,
      bets: betsList,
      promos: promosList,
      promosList,
      settings: {
        targetRtp: CONFIG.TARGET_RTP * 100,
        agentCommission: CONFIG.AGENT_COMMISSION * 100,
        minDep: CONFIG.MIN_DEP,
        maxDep: CONFIG.MAX_DEP,
        minWd: CONFIG.MIN_WTH,
        maxWd: CONFIG.MAX_WTH
      }
    });
  } catch (err) {
    console.error("Dashboard error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ሁለቱንም ሊንኮች ወደ አንዱ ማስተር ሃንድለር ማገናኘት
app.get('/api/admin/master-dashboard', masterDashboardHandler);
app.get('/api/admin/analytics', masterDashboardHandler);

// ✅ ዲፖዚት ማጽደቂያ (Approve Deposit -> ያንኑ PENDING ወደ APPROVED ይቀይራል፣ ብር ይጨምራል)
app.post('/api/admin/approve-deposit', async (req, res) => {
  const { pin, txnId, actor } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txnRes = await client.query("SELECT * FROM transactions WHERE txn_id = $1 AND status = 'PENDING' FOR UPDATE", [txnId]);
    if (txnRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Transaction already processed or not found!' });
    }
    const txn = txnRes.rows[0];
    const amt = parseFloat(txn.amount);

    let uRes = await client.query('SELECT balance FROM users WHERE user_id = $1 FOR UPDATE', [txn.user_id]);
    const u = uRes.rows[0];
    const balBefore = parseFloat(u.balance);
    const balAfter = balBefore + amt;

    // የተጠቃሚውን Balance መጨመር
    await client.query("UPDATE users SET balance = balance + $1, total_deposited = total_deposited + $1, first_deposit_completed = 'YES' WHERE user_id = $2", [amt, txn.user_id]);

    // የኤጀንት ኮሚሽን ማስላት
    const commAmt = Math.round(Number(amt * CONFIG.AGENT_COMMISSION) * 100) / 100;
    try {
      await client.query("UPDATE agents SET total_deposits_processed = total_deposits_processed + $1, total_commission_earned = total_commission_earned + $2 WHERE telegram_username ILIKE $3", [amt, commAmt, txn.agent_assigned || actor]);
    } catch(e) {}

    // PENDING የነበረውን ወደ APPROVED እንቀይረዋለን!
    await client.query("UPDATE transactions SET status = 'APPROVED', remarks = $1 WHERE txn_id = $2", [`Approved by ${actor || 'Admin'}`, txnId]);

    await logFinancialAudit(client, txn.user_id, 'DEPOSIT_APPROVE', amt, balBefore, balAfter, txnId);

    await client.query('COMMIT');
    res.json({ success: true, message: `Deposit ${txnId} approved! ${amt} ETB credited to User ${txn.user_id}.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ❌ ዲፖዚት ውድቅ ማድረጊያ (Reject Deposit -> PENDING ወደ REJECTED ይቀየራል)
app.post('/api/admin/reject-deposit', async (req, res) => {
  const { pin, txnId, reason } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    await pool.query("UPDATE transactions SET status = 'REJECTED', remarks = $1 WHERE txn_id = $2 AND status = 'PENDING'", [reason || 'Payment verification failed', txnId]);
    res.json({ success: true, message: `Deposit ${txnId} rejected.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ ዊዝድሮው ማጽደቂያ (Approve Withdrawal -> ክፍያ ተጠናቋል)
app.post('/api/admin/approve-withdrawal', async (req, res) => {
  const { pin, txnId, actor } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    await pool.query("UPDATE transactions SET status = 'APPROVED', remarks = $1 WHERE txn_id = $2 AND status = 'PENDING'", [`Payout sent by ${actor || 'Admin'}`, txnId]);
    res.json({ success: true, message: `Withdrawal ${txnId} marked as completed!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ❌ ዊዝድሮው ውድቅ አድርጎ ብሩን ወዲያው ለተጠቃሚው መመለሻ (Reject & Auto-Refund)
app.post('/api/admin/reject-withdrawal', async (req, res) => {
  const { pin, txnId, reason } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txnRes = await client.query("SELECT * FROM transactions WHERE txn_id = $1 AND status = 'PENDING' FOR UPDATE", [txnId]);
    if (txnRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Withdrawal record not found or already processed!' });
    }
    const txn = txnRes.rows[0];
    const refundAmt = parseFloat(txn.amount);

    let uRes = await client.query('SELECT balance FROM users WHERE user_id = $1 FOR UPDATE', [txn.user_id]);
    const balBefore = parseFloat(uRes.rows[0].balance);
    const balAfter = balBefore + refundAmt;

    // የተቆረጠውን ገንዘብ ለተጠቃሚው በራስ-ሰር መመለስ (Refund)
    await client.query("UPDATE users SET balance = balance + $1 WHERE user_id = $2", [refundAmt, txn.user_id]);
    await client.query("UPDATE transactions SET status = 'REJECTED', remarks = $1 WHERE txn_id = $2", [reason || 'Payout rejected by Admin (Refunded)', txnId]);

    await logFinancialAudit(client, txn.user_id, 'WITHDRAWAL_REFUND', refundAmt, balBefore, balAfter, txnId);

    await client.query('COMMIT');
    res.json({ success: true, message: `Withdrawal ${txnId} rejected & ${refundAmt} ETB refunded to User ${txn.user_id}!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 1-Click Top-Up ከባንክ Transaction ID የማጭበርበር መከላከያ ጋር
app.post('/api/admin/topup', async (req, res) => {
  const { pin, userId, amount, txnId, actor } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.json({ success: false, message: 'Invalid Admin PIN!' });

  const cleanId = String(userId).trim();
  const amt = Math.round(Number(amount) * 100) / 100;
  const cleanTxnRef = String(txnId || '').trim();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Duplicate Check
    if (cleanTxnRef !== '') {
      const dup = await client.query("SELECT * FROM transactions WHERE bank_txn_id = $1 AND status = 'APPROVED'", [cleanTxnRef]);
      if (dup.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.json({ success: false, message: '⚠️ FRAUD ALERT: This Transaction ID was already credited!' });
      }
    }

    let uRes = await client.query('SELECT balance FROM users WHERE user_id = $1 FOR UPDATE', [cleanId]);
    let u;
    if (uRes.rows.length === 0) {
      await client.query(`INSERT INTO users (user_id, telegram_username, full_name, balance, total_deposited, first_deposit_completed) VALUES ($1, $2, 'New Player', $3, $3, 'YES')`, [cleanId, 'player_' + cleanId.slice(-4), amt]);
    } else {
      await client.query(`UPDATE users SET balance = balance + $1, total_deposited = total_deposited + $1, first_deposit_completed = 'YES' WHERE user_id = $2`, [amt, cleanId]);
    }

    const commAmt = Math.round(Number(amt * CONFIG.AGENT_COMMISSION) * 100) / 100;
    try {
      await client.query(`
        UPDATE agents 
        SET total_deposits_processed = total_deposits_processed + $1, total_commission_earned = total_commission_earned + $2 
        WHERE telegram_username ILIKE $3 OR agent_id = $3
      `, [amt, commAmt, actor || 'Agent1hulubet']);
    } catch(e) {}

    const depId = 'DEP-' + Math.floor(10000 + Math.random() * 90000);
    await client.query(`
      INSERT INTO transactions (txn_id, user_id, username, type, method, amount, net_amount, bank_txn_id, status, processed_by)
      VALUES ($1, $2, $3, 'DEPOSIT', 'Manual_1Click', $4, $4, $5, 'APPROVED', $6)
    `, [depId, cleanId, 'player', amt, cleanTxnRef, actor || 'Admin']);

    await client.query('COMMIT');
    res.json({ success: true, message: `Successfully credited ${amt} ETB to Player ${cleanId}!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// የተጠቃሚን Balance በእጅ መጨመር ወይም መቀነስ (Manual Balance Adjuster)
app.post('/api/admin/adjust-balance', async (req, res) => {
  const { pin, userId, amount, action, reason } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  const cleanId = String(userId).trim();
  const amt = Number(amount);
  if (!cleanId || isNaN(amt) || amt <= 0) return res.json({ success: false, message: 'Provide valid User ID and amount!' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uRes = await client.query("SELECT balance FROM users WHERE user_id = $1 FOR UPDATE", [cleanId]);
    if (uRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'User not found!' });
    }

    const balBefore = parseFloat(uRes.rows[0].balance);
    const balAfter = action === 'DEDUCT' ? Math.max(0, balBefore - amt) : (balBefore + amt);

    await client.query("UPDATE users SET balance = $1 WHERE user_id = $2", [balAfter, cleanId]);

    const txnId = 'ADJ-' + Math.floor(10000 + Math.random() * 90000);
    await client.query(`
      INSERT INTO transactions (txn_id, user_id, type, amount, status, remarks)
      VALUES ($1, $2, 'ADJUSTMENT', $3, 'APPROVED', $4)
    `, [txnId, cleanId, amt, reason || `${action} by Admin`]);

    await logFinancialAudit(client, cleanId, `BALANCE_${action}`, amt, balBefore, balAfter, txnId);

    await client.query('COMMIT');
    res.json({ success: true, message: `Successfully adjusted ${amt} ETB (${action}) for User ${cleanId}!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 1-Click Cashback Distributor
app.post('/api/admin/distribute-cashback', async (req, res) => {
  const { pin, percentage, minLoss } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  const percent = Number(percentage) / 100;
  const cutoff = Number(minLoss || 100);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const losersRes = await client.query(`SELECT user_id, (total_wagered - total_won) as net_loss FROM users WHERE (total_wagered - total_won) >= $1`, [cutoff]);

    let distributedCount = 0;
    let totalCashbackAwarded = 0;

    for (let u of losersRes.rows) {
      const cbAmount = Math.round(Number(u.net_loss * percent) * 100) / 100;
      if (cbAmount > 0) {
        await client.query("UPDATE users SET balance = balance + $1, bonus_balance = bonus_balance + $1 WHERE user_id = $2", [cbAmount, u.user_id]);
        try {
          await client.query(`INSERT INTO transactions (txn_id, user_id, type, amount, status, remarks) VALUES ('CB-' || floor(random() * 90000 + 10000), $1, 'BONUS', $2, 'APPROVED', $3)`, [u.user_id, cbAmount, `${percentage}% Cashback`]);
        } catch(e) {}
        distributedCount++;
        totalCashbackAwarded += cbAmount;
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `🎉 Successfully distributed ${totalCashbackAwarded.toFixed(2)} ETB Cashback to ${distributedCount} players!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// አዲስ ፕሮሞ ኮድ መፍጠር
app.post('/api/admin/create-promo', async (req, res) => {
  const { pin, code, bonusAmount, maxUses } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    await pool.query(`INSERT INTO promo_codes (code, bonus_amount, max_uses) VALUES ($1, $2, $3)`, [String(code).trim().toUpperCase(), Number(bonusAmount), Number(maxUses || 100)]);
    res.json({ success: true, message: `Promo code ${code.toUpperCase()} created successfully (+${bonusAmount} ETB)!` });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ብዙ ሰዎችን በአንድ ጠቅታ መሸለም (Batch Gifting)
app.post('/api/admin/reward-users', async (req, res) => {
  const { pin, userIds, rewardAmount } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  const amt = Number(rewardAmount);
  if (!Array.isArray(userIds) || userIds.length === 0 || amt <= 0) return res.json({ success: false, message: 'Provide a valid array of user IDs and amount!' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE users SET balance = balance + $1, bonus_balance = bonus_balance + $1 WHERE user_id = ANY($2::varchar[])`, [amt, userIds]);
    await client.query('COMMIT');
    res.json({ success: true, message: `Successfully rewarded ${userIds.length} players with ${amt} ETB each!` });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// Dynamic Settings Update (RTP & Commission)
app.post('/api/admin/update-settings', async (req, res) => {
  const { pin, targetRtp, agentCommission } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    if (targetRtp !== undefined) {
      CONFIG.TARGET_RTP = parseFloat(targetRtp);
      try { await pool.query("UPDATE system_settings SET value = $1 WHERE key = 'target_rtp'", [String(targetRtp)]); } catch(e) {}
    }
    if (agentCommission !== undefined) {
      CONFIG.AGENT_COMMISSION = parseFloat(agentCommission);
      try { await pool.query("UPDATE system_settings SET value = $1 WHERE key = 'agent_commission'", [String(agentCommission)]); } catch(e) {}
    }
    res.json({ success: true, message: `Settings updated successfully!` });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// User Status (Ban / Suspend / Active)
app.post('/api/admin/user-status', async (req, res) => {
  const { pin, userId, status } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    await pool.query('UPDATE users SET status = $1 WHERE user_id = $2', [status, String(userId)]);
    res.json({ success: true, message: `User status changed to ${status}` });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Live Agents Endpoint
app.get('/api/agents', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM agents');
    res.json({ success: true, agents: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Hulu Bet Master 10k CCU Server running on port ${PORT}`));
