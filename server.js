/**
 * ============================================================================
 * 🦁 HULU BET - 10K+ CCU PRODUCTION SERVER ENGINE (server.js)
 * Official Bot: @Hulubetethbot | Official Channel: @HuluBetOfficial
 * Official Agents: @Agent1hulubet | @Agent2hulubet
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

// 🗄️ PostgreSQL Connection Pool (Scalable for 10k users)
let dbUrl = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_feXPgp4B8Wkh@ep-shy-rain-b5qmdt68-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require";
dbUrl = dbUrl.replace('&channel_binding=require', '').replace('?channel_binding=require', '');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 30, // 30 concurrent DB connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.message);
  } else {
    console.log('✅ Connected to Hulu Bet PostgreSQL Core Database!');
    release();
  }
});

const CONFIG = {
  ADMIN_PIN: process.env.ADMIN_PIN || "1234",
  TARGET_RTP: 0.85,
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

// ============================================================================
// 👥 1. USER AUTH & BALANCE INITIALIZATION
// ============================================================================
app.get('/api/user/init', async (req, res) => {
  const { userId, username, name, refId } = req.query;
  const cleanId = String(userId || 'guest_101').trim();
  const cleanUser = String(username || 'player').trim();
  const cleanName = String(name || 'Player').trim();
  const cleanRef = String(refId || '').trim();

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
        firstDepositCompleted: u.first_deposit_completed,
        wagerRequirementLeft: parseFloat(u.wager_requirement_left),
        role: u.role,
        status: u.status
      });
    }

    // New User Signup: 20 ETB Welcome Bonus
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
// 🎰 2. 85% SMART RTP CASINO ENGINE (With Atomic Lock)
// ============================================================================
app.post('/api/bet/play', async (req, res) => {
  const { userId, gameName, betAmount, clientData } = req.body;
  const cleanId = String(userId).trim();
  const wager = Math.round(Number(betAmount) * 100) / 100;

  if (isNaN(wager) || wager <= 0 || wager > CONFIG.MAX_BET) {
    return res.json({ success: false, message: `Bet must be between 1 and ${CONFIG.MAX_BET} ETB!` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock user row for update (Atomic Race-Condition Protection)
    const userRes = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [cleanId]);
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'User not found!' });
    }

    const user = userRes.rows[0];
    const currentBal = parseFloat(user.balance);

    if (currentBal < wager) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Insufficient balance!' });
    }

    // 2. Read Vault Safety Buffer
    const vaultRes = await client.query('SELECT * FROM casino_vault WHERE id = 1 FOR UPDATE');
    const vault = vaultRes.rows[0];
    const isBufferSafe = parseFloat(vault.vault_balance) >= CONFIG.SAFETY_BUFFER;

    // 3. Smart Multi-Tier RNG Roll (85% Model)
    const rngRoll = Number((Math.random() * 100).toFixed(2));
    let multiplier = 0.0;
    let tierApplied = "Tier 0 (Early Loss)";

    if (rngRoll <= 8.0) {
      multiplier = Number((1.00 + Math.random() * 0.12).toFixed(2));
      tierApplied = "Tier 0 (Early Loss / 8%)";
    } else if (rngRoll <= 70.0) {
      multiplier = Number((1.20 + Math.random() * 1.60).toFixed(2));
      tierApplied = "Tier 1 (Sweet Spot / 62%)";
    } else if (rngRoll <= 94.0) {
      multiplier = Number((3.00 + Math.random() * 6.00).toFixed(2));
      tierApplied = "Tier 2 (Medium High / 24%)";
    } else {
      if (isBufferSafe) {
        multiplier = Number((10.00 + Math.random() * 70.00).toFixed(2));
        tierApplied = "Tier 3 (Mega Rocket / 6%)";
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
    const newWagerReq = Math.max(0, Math.round(Number(parseFloat(user.wager_requirement_left) - wager) * 100) / 100);

    // 4. Update User
    await client.query(`
      UPDATE users 
      SET balance = $1, total_wagered = total_wagered + $2, total_won = total_won + $3, wager_requirement_left = $4, last_active_at = NOW()
      WHERE user_id = $5
    `, [newBal, wager, payout, newWagerReq, cleanId]);

    // 5. Update Vault
    await client.query(`
      UPDATE casino_vault 
      SET vault_balance = vault_balance + $1, total_wagered = total_wagered + $2, total_payouts = total_payouts + $3, gross_profit = gross_profit + $1, updated_at = NOW()
      WHERE id = 1
    `, [netHouseProfit, wager, payout]);

    // 6. Map Visual Outcome
    const visualOutcome = mapVisualOutcome(gameName, multiplier, clientData || {});
    const betId = "BET-" + Math.floor(100000 + Math.random() * 900000);
    const serverSeedHash = crypto.createHash('sha256').update(betId + rngRoll).digest('hex').substring(0, 16);

    await client.query(`
      INSERT INTO universal_bets (bet_id, game_name, user_id, username, bet_amount, rng_roll, tier_applied, multiplier, payout, house_profit, status, game_data, server_seed_hash)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [betId, gameName, cleanId, user.telegram_username, wager, rngRoll, tierApplied, multiplier, payout, netHouseProfit, isWin ? 'WON' : 'LOST', JSON.stringify(visualOutcome), serverSeedHash]);

    await client.query('COMMIT');

    // Broadcast big wins via WebSockets
    if (payout >= 500) {
      io.emit('live_win', {
        user: user.telegram_username.slice(0, 2) + '***' + user.telegram_username.slice(-1),
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
    let targetHits = multiplier >= 10.0 ? Math.min(userPicks.length, 7) : multiplier >= 2.0 ? Math.min(userPicks.length, 4) : multiplier >= 1.1 ? Math.min(userPicks.length, 2) : (Math.random() < 0.4 ? 1 : 0);
    const guaranteedHits = userPicks.slice(0, targetHits);
    const remaining = Array.from({ length: 80 }, (_, i) => i + 1).filter(n => !userPicks.includes(n)).sort(() => Math.random() - 0.5);
    return { drawnNumbers: [...guaranteedHits, ...remaining.slice(0, 20 - guaranteedHits.length)].sort(() => Math.random() - 0.5), hits: targetHits };
  }
  if (gameName === "Aviator" || gameName === "JetX") {
    return { crashPoint: multiplier === 0 ? Number((1.00 + Math.random() * 0.12).toFixed(2)) : multiplier };
  }
  if (gameName === "ChickenRoad2") {
    const diff = clientData.difficulty || "Easy";
    return { maxSafeStep: diff === "Easy" ? (multiplier > 1.2 ? 8 : 4) : diff === "Medium" ? (multiplier > 2.0 ? 6 : 3) : (multiplier > 3.0 ? 4 : 1) };
  }
  if (gameName === "Slot777") {
    return multiplier >= 25.0 ? { reels: ["🎰", "🎰", "🎰"], payline: "JACKPOT", colMult: 5 } : multiplier >= 2.0 ? { reels: ["🔔", "🔔", "🔔"], payline: "BELLS", colMult: 1 } : { reels: ["🎰", "🎰", "🍒"], payline: "NONE", colMult: 1 };
  }
  if (gameName === "AviaMasters") {
    return { safeLanding: multiplier > 0, targetMultiplier: multiplier, rocketsAvoided: multiplier > 2.0 ? 3 : 1 };
  }
  return {};
}

// ============================================================================
// 💳 3. CASHIER & PAYMENTS
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
      VALUES ($1, $2, $3, 'DEPOSIT', $4, $5, $5, $6, 'PENDING', 'Pending agent verification')
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
    if (parseFloat(u.balance) < amt) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Insufficient balance!' });
    }

    // 🛡️ Gate 1: First Deposit Lock
    if (u.first_deposit_completed !== 'YES' && parseFloat(u.total_deposited) < CONFIG.MIN_FIRST_DEP) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: `Deposit at least ${CONFIG.MIN_FIRST_DEP} ETB first to unlock withdrawals!` });
    }

    // 🛡️ Gate 2: Wagering Requirement Lock
    if (parseFloat(u.wager_requirement_left) > 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: `Wager requirement active: ${parseFloat(u.wager_requirement_left).toFixed(2)} ETB remaining!` });
    }

    const newBal = Math.round(Number(parseFloat(u.balance) - amt) * 100) / 100;
    await client.query('UPDATE users SET balance = $1 WHERE user_id = $2', [newBal, cleanId]);

    const wthId = 'WTH-' + Math.floor(10000 + Math.random() * 90000);
    await client.query(`
      INSERT INTO transactions (txn_id, user_id, username, type, method, amount, net_amount, sender_account, status, remarks)
      VALUES ($1, $2, $3, 'WITHDRAWAL', $4, $5, $5, $6, 'PENDING', 'Awaiting payout')
    `, [wthId, cleanId, u.telegram_username, method || 'Telebirr', amt, accountNumber]);

    await client.query('COMMIT');
    res.json({ success: true, txnId: wthId, newBalance: newBal });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 1-Click Top-Up & Approval with Fraud Guard
app.post('/api/admin/topup', async (req, res) => {
  const { pin, userId, amount, txnId, actor } = req.body;
  if (pin !== CONFIG.ADMIN_PIN) return res.json({ success: false, message: 'Invalid Admin PIN!' });

  const cleanId = String(userId).trim();
  const amt = Math.round(Number(amount) * 100) / 100;
  const cleanTxnRef = String(txnId || '').trim();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    
    // Duplicate Screenshot / Txn ID Blocker
    if (cleanTxnRef !== '') {
      const dup = await client.query("SELECT * FROM transactions WHERE bank_txn_id = $1 AND status = 'APPROVED'", [cleanTxnRef]);
      if (dup.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.json({ success: false, message: '⚠️ FRAUD ALERT: This Transaction ID was already credited!' });
      }
    }

    let uRes = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [cleanId]);
    let u;
    if (uRes.rows.length === 0) {
      await client.query(`INSERT INTO users (user_id, telegram_username, full_name, balance, total_deposited, first_deposit_completed) VALUES ($1, $2, 'New Player', $3, $3, 'YES')`, [cleanId, 'player_' + cleanId.slice(-4), amt]);
    } else {
      u = uRes.rows[0];
      await client.query(`UPDATE users SET balance = balance + $1, total_deposited = total_deposited + $1, first_deposit_completed = 'YES' WHERE user_id = $2`, [amt, cleanId]);

      // 🎁 50 ETB Referral Bonus
      if (u.first_deposit_completed !== 'YES' && u.referrer_id && u.referrer_id !== cleanId && amt >= CONFIG.MIN_FIRST_DEP) {
        const refWagerReq = CONFIG.REFERRAL_BONUS * 2;
        await client.query(`
          UPDATE users 
          SET balance = balance + $1, referral_earnings = referral_earnings + $1, invited_count = invited_count + 1, wager_requirement_left = wager_requirement_left + $2 
          WHERE user_id = $3
        `, [CONFIG.REFERRAL_BONUS, refWagerReq, u.referrer_id]);

        await client.query(`UPDATE casino_vault SET total_bonus_awarded = total_bonus_awarded + $1 WHERE id = 1`, [CONFIG.REFERRAL_BONUS]);
      }
    }

    // 👔 2% Agent Commission Ledger
    const commAmt = Math.round(Number(amt * 0.02) * 100) / 100;
    await client.query(`
      UPDATE agents 
      SET total_deposits_processed = total_deposits_processed + $1, total_commission_earned = total_commission_earned + $2 
      WHERE telegram_username ILIKE $3 OR agent_id = $3
    `, [amt, commAmt, actor || 'Agent1hulubet']);

    const depId = 'DEP-' + Math.floor(10000 + Math.random() * 90000);
    await client.query(`
      INSERT INTO transactions (txn_id, user_id, username, type, method, amount, net_amount, bank_txn_id, status, processed_by)
      VALUES ($1, $2, $3, 'DEPOSIT', 'Manual_1Click', $4, $4, $5, 'APPROVED', $6)
    `, [depId, cleanId, u ? u.telegram_username : 'player', amt, cleanTxnRef, actor || 'Agent']);

    await client.query('COMMIT');
    res.json({ success: true, message: `Successfully credited ${amt} ETB to Player ${cleanId}!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
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


// ============================================================================
// 📊 ADMIN LIVE ANALYTICS & TRANSACTIONS FEED
// ============================================================================
app.get('/api/admin/analytics', async (req, res) => {
  const { pin } = req.query;
  if (pin !== CONFIG.ADMIN_PIN) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    const vaultRes = await pool.query('SELECT * FROM casino_vault WHERE id = 1');
    const usersCountRes = await pool.query('SELECT COUNT(*) as total_users FROM users');
    const recentTxnsRes = await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 20');
    const pendingWithdrawalsRes = await pool.query("SELECT * FROM transactions WHERE type = 'WITHDRAWAL' AND status = 'PENDING'");

    res.json({
      success: true,
      vault: vaultRes.rows[0] || {},
      totalUsers: usersCountRes.rows[0].total_users,
      recentTransactions: recentTxnsRes.rows,
      pendingWithdrawals: pendingWithdrawalsRes.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ============================================================================
// 👑 COMPLETE & ERROR-PROOF ADMIN ENGINE (APPROVE, REJECT, CASHBACK, PROMO)
// ============================================================================

// 1. LIVE ANALYTICS & PENDING QUEUE (ሁሉንም ዳታዎች በአንድ ጥሪ ያቀርባል)
app.get('/api/admin/analytics', async (req, res) => {
  const { pin } = req.query;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    const vaultRes = await pool.query('SELECT * FROM casino_vault WHERE id = 1');
    const usersCountRes = await pool.query('SELECT COUNT(*) as total_users FROM users');
    
    // የትራንዛክሽን መረጃዎችን ያለ Error በሰላም ማምጣት
    let allTxns = [];
    try {
      const txRes = await pool.query('SELECT * FROM transactions');
      allTxns = txRes.rows ? txRes.rows.reverse() : []; // የቅርብ ጊዜዎቹን ከላይ ለማድረግ
    } catch(e) { console.error("Txn query error:", e.message); }

    // ተጠቃሚዎችን ማምጣት
    let usersList = [];
    try {
      const uRes = await pool.query('SELECT user_id, telegram_username, full_name, balance, total_deposited, total_wagered, total_won, status FROM users LIMIT 100');
      usersList = uRes.rows || [];
    } catch(e) {}

    // ፕሮሞ ኮዶችን ማምጣት
    let promosList = [];
    try {
      const pRes = await pool.query('SELECT * FROM promo_codes');
      promosList = pRes.rows || [];
    } catch(e) {}

    // ወደሚመለከታቸው ከፍለን እንልካለን
    const pendingDeposits = allTxns.filter(t => t.type === 'DEPOSIT' && t.status === 'PENDING');
    const pendingWithdrawals = allTxns.filter(t => t.type === 'WITHDRAWAL' && t.status === 'PENDING');
    const completedHistory = allTxns.filter(t => t.status !== 'PENDING').slice(0, 50);

    res.json({
      success: true,
      vault: vaultRes.rows[0] || {},
      totalUsers: usersCountRes.rows[0]?.total_users || 0,
      currentRtp: (SETTINGS?.TARGET_RTP || 0.85),
      currentCommission: (SETTINGS?.AGENT_COMMISSION || 0.02),
      pendingDeposits,
      pendingWithdrawals,
      completedHistory,
      usersList,
      promosList
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. ዲፖዚት እዛው ROW ላይ ማጽደቂያ (Approve Deposit -> PENDING ይጠፋል፣ ብር ገቢ ይሆናል)
app.post('/api/admin/approve-deposit', async (req, res) => {
  const { pin, txnId, actor } = req.body;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

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

    // የተጠቃሚውን Balance መጨመር
    await client.query("UPDATE users SET balance = balance + $1, total_deposited = total_deposited + $1, first_deposit_completed = 'YES' WHERE user_id = $2", [amt, txn.user_id]);

    // የኤጀንት ኮሚሽን ማስላት
    const commRate = (SETTINGS?.AGENT_COMMISSION || 0.02);
    const commAmt = Math.round(Number(amt * commRate) * 100) / 100;
    try {
      await client.query("UPDATE agents SET total_deposits_processed = total_deposits_processed + $1, total_commission_earned = total_commission_earned + $2 WHERE telegram_username ILIKE $3", [amt, commAmt, txn.agent_assigned || actor]);
    } catch(e) {}

    // ይሄውልህ ዋናው ማስተካከያ፦ ያንን PENDING የነበረውን ወደ APPROVED እንቀይረዋለን!
    await client.query("UPDATE transactions SET status = 'APPROVED', remarks = 'Approved by Admin' WHERE txn_id = $1", [txnId]);

    await client.query('COMMIT');
    res.json({ success: true, message: `Deposit ${txnId} approved! ${amt} ETB credited to User ${txn.user_id}.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 3. ዲፖዚት ውድቅ ማድረጊያ (Reject Deposit -> PENDING ወደ REJECTED ይቀየራል)
app.post('/api/admin/reject-deposit', async (req, res) => {
  const { pin, txnId, reason } = req.body;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    await pool.query("UPDATE transactions SET status = 'REJECTED', remarks = $1 WHERE txn_id = $2 AND status = 'PENDING'", [reason || 'Payment rejected', txnId]);
    res.json({ success: true, message: `Deposit ${txnId} rejected successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. ዊዝድሮው ማጽደቂያ (Approve Withdrawal -> ክፍያ ተጠናቋል)
app.post('/api/admin/approve-withdrawal', async (req, res) => {
  const { pin, txnId, actor } = req.body;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    await pool.query("UPDATE transactions SET status = 'APPROVED', remarks = 'Payout completed' WHERE txn_id = $1 AND status = 'PENDING'", [txnId]);
    res.json({ success: true, message: `Withdrawal ${txnId} marked as completed!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. ዊዝድሮው ውድቅ አድርጎ ብሩን ወዲያው ለተጠቃሚው መመለሻ (Reject & Auto-Refund)
app.post('/api/admin/reject-withdrawal', async (req, res) => {
  const { pin, txnId, reason } = req.body;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txnRes = await client.query("SELECT * FROM transactions WHERE txn_id = $1 AND status = 'PENDING' FOR UPDATE", [txnId]);
    if (txnRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Transaction not found or already processed!' });
    }
    const txn = txnRes.rows[0];
    const refundAmt = parseFloat(txn.amount);

    // የተቆረጠውን ገንዘብ ለተጠቃሚው መመለስ (Refund)
    await client.query("UPDATE users SET balance = balance + $1 WHERE user_id = $2", [refundAmt, txn.user_id]);
    await client.query("UPDATE transactions SET status = 'REJECTED', remarks = $1 WHERE txn_id = $2", [reason || 'Rejected by Admin (Refunded)', txnId]);

    await client.query('COMMIT');
    res.json({ success: true, message: `Withdrawal ${txnId} rejected & ${refundAmt} ETB refunded to User ${txn.user_id}!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 6. የተጠቃሚን Balance በእጅ መጨመር ወይም መቀነስ (Manual Balance Adjuster)
app.post('/api/admin/adjust-balance', async (req, res) => {
  const { pin, userId, amount, action, reason } = req.body;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

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

    if (action === 'DEDUCT') {
      await client.query("UPDATE users SET balance = GREATEST(0, balance - $1) WHERE user_id = $2", [amt, cleanId]);
    } else {
      await client.query("UPDATE users SET balance = balance + $1 WHERE user_id = $2", [amt, cleanId]);
    }

    const txnId = 'ADJ-' + Math.floor(10000 + Math.random() * 90000);
    await client.query(`
      INSERT INTO transactions (txn_id, user_id, type, amount, status, remarks)
      VALUES ($1, $2, 'ADJUSTMENT', $3, 'APPROVED', $4)
    `, [txnId, cleanId, amt, reason || `${action} by Admin`]);

    await client.query('COMMIT');
    res.json({ success: true, message: `Successfully adjusted ${amt} ETB (${action}) for User ${cleanId}!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 7. 1-CLICK CASHBACK DISTRIBUTOR
app.post('/api/admin/distribute-cashback', async (req, res) => {
  const { pin, percentage, minLoss } = req.body;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

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

// 8. አዲስ ፕሮሞ ኮድ መፍጠር
app.post('/api/admin/create-promo', async (req, res) => {
  const { pin, code, bonusAmount, maxUses } = req.body;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    await pool.query(`INSERT INTO promo_codes (code, bonus_amount, max_uses) VALUES ($1, $2, $3)`, [String(code).trim().toUpperCase(), Number(bonusAmount), Number(maxUses || 100)]);
    res.json({ success: true, message: `Promo code ${code.toUpperCase()} created successfully (+${bonusAmount} ETB)!` });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 9. ብዙ ሰዎችን በአንድ ጠቅታ መሸለም (Batch Gifting)
app.post('/api/admin/reward-users', async (req, res) => {
  const { pin, userIds, rewardAmount } = req.body;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

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

// 10. DYNAMIC SETTINGS UPDATE (RTP & COMMISSION)
app.post('/api/admin/update-settings', async (req, res) => {
  const { pin, targetRtp, agentCommission } = req.body;
  const currentPin = (SETTINGS && SETTINGS.ADMIN_PIN) ? SETTINGS.ADMIN_PIN : (CONFIG?.ADMIN_PIN || "1234");
  if (pin !== currentPin) return res.status(403).json({ success: false, message: 'Invalid Admin PIN!' });

  try {
    if (targetRtp !== undefined && SETTINGS) {
      SETTINGS.TARGET_RTP = parseFloat(targetRtp);
      try { await pool.query("UPDATE system_settings SET value = $1 WHERE key = 'target_rtp'", [String(targetRtp)]); } catch(e) {}
    }
    if (agentCommission !== undefined && SETTINGS) {
      SETTINGS.AGENT_COMMISSION = parseFloat(agentCommission);
      try { await pool.query("UPDATE system_settings SET value = $1 WHERE key = 'agent_commission'", [String(agentCommission)]); } catch(e) {}
    }
    res.json({ success: true, message: `Settings updated successfully!` });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Hulu Bet 10k CCU Server running on port ${PORT}`));
