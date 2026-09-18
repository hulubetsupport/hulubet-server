const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// 🗄️ Clean Connection String & Safe SSL
let dbUrl = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_feXPgp4B8Wkh@ep-shy-rain-b5qmdt68-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require";
dbUrl = dbUrl.replace('&channel_binding=require', '').replace('?channel_binding=require', '');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

// Database Connection Test on Startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.message);
  } else {
    console.log('✅ Connected to Neon PostgreSQL Database successfully!');
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
// 👥 1. USER AUTH & INIT
// ============================================================================
app.get('/api/user/init', async (req, res) => {
  const { userId, username, name, refId } = req.query;
  const cleanId = String(userId || 'guest_101').trim();
  const cleanUser = String(username || 'player').trim();
  const cleanName = String(name || 'Player').trim();

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
        role: u.role,
        status: u.status
      });
    }

    const initialWagerReq = CONFIG.WELCOME_BONUS * CONFIG.WAGER_REQ_MULT;
    await pool.query(`
      INSERT INTO users (user_id, telegram_username, full_name, balance, bonus_balance, wager_requirement_left, referrer_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [cleanId, cleanUser, cleanName, CONFIG.WELCOME_BONUS, CONFIG.WELCOME_BONUS, initialWagerReq, refId || '']);

    await pool.query(`UPDATE casino_vault SET total_bonus_awarded = total_bonus_awarded + $1 WHERE id = 1`, [CONFIG.WELCOME_BONUS]);

    return res.json({
      success: true,
      isNew: true,
      userId: cleanId,
      username: cleanUser,
      name: cleanName,
      balance: CONFIG.WELCOME_BONUS,
      bonusBalance: CONFIG.WELCOME_BONUS,
      role: 'Player',
      status: 'Active'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 🎰 2. 85% SMART RTP CASINO ENGINE
// ============================================================================
app.post('/api/bet/play', async (req, res) => {
  const { userId, gameName, betAmount, clientData } = req.body;
  const cleanId = String(userId).trim();
  const wager = Number(betAmount);

  if (isNaN(wager) || wager <= 0 || wager > CONFIG.MAX_BET) {
    return res.json({ success: false, message: `Bet must be between 1 and ${CONFIG.MAX_BET} ETB!` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    const vaultRes = await client.query('SELECT * FROM casino_vault WHERE id = 1 FOR UPDATE');
    const vault = vaultRes.rows[0];
    const isBufferSafe = parseFloat(vault.vault_balance) >= CONFIG.SAFETY_BUFFER;

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
        tierApplied = "Tier 3 (Protected)";
      }
    }

    let payout = Number((wager * multiplier).toFixed(2));
    if (payout > CONFIG.MAX_PAYOUT) {
      payout = CONFIG.MAX_PAYOUT;
      multiplier = Number((payout / wager).toFixed(2));
    }

    const isWin = payout > 0;
    const netHouseProfit = Number((wager - payout).toFixed(2));
    const newBal = Number((currentBal - wager + payout).toFixed(2));
    const newWagerReq = Math.max(0, parseFloat(user.wager_requirement_left) - wager);

    await client.query(`
      UPDATE users 
      SET balance = $1, total_wagered = total_wagered + $2, total_won = total_won + $3, wager_requirement_left = $4, last_active_at = NOW()
      WHERE user_id = $5
    `, [newBal, wager, payout, newWagerReq, cleanId]);

    await client.query(`
      UPDATE casino_vault 
      SET vault_balance = vault_balance + $1, total_wagered = total_wagered + $2, total_payouts = total_payouts + $3, gross_profit = gross_profit + $1, updated_at = NOW()
      WHERE id = 1
    `, [netHouseProfit, wager, payout]);

    const visualOutcome = mapVisualOutcome(gameName, multiplier, clientData || {});
    const betId = "BET-" + Math.floor(100000 + Math.random() * 900000);

    await client.query(`
      INSERT INTO universal_bets (bet_id, game_name, user_id, username, bet_amount, rng_roll, tier_applied, multiplier, payout, house_profit, status, game_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [betId, gameName, cleanId, user.telegram_username, wager, rngRoll, tierApplied, multiplier, payout, netHouseProfit, isWin ? 'WON' : 'LOST', JSON.stringify(visualOutcome)]);

    await client.query('COMMIT');

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
    return { maxSafeStep: multiplier > 3.0 ? 8 : multiplier > 1.5 ? 5 : multiplier > 1.0 ? 3 : 0 };
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
// 💳 3. CASHIER & PAYMENTS
// ============================================================================
app.post('/api/cashier/deposit', async (req, res) => {
  const { userId, username, amount, method, agentAssigned } = req.body;
  const depId = 'DEP-' + Math.floor(10000 + Math.random() * 90000);

  try {
    await pool.query(`
      INSERT INTO transactions (txn_id, user_id, username, type, method, amount, net_amount, agent_assigned, status, remarks)
      VALUES ($1, $2, $3, 'DEPOSIT', $4, $5, $5, $6, 'PENDING', 'Pending agent verification')
    `, [depId, String(userId).trim(), username || 'player', method || 'Telebirr', Number(amount), agentAssigned || 'agent_aymen_keno']);

    res.json({ success: true, txnId: depId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cashier/withdraw', async (req, res) => {
  const { userId, amount, accountNumber, method } = req.body;
  const cleanId = String(userId).trim();
  const amt = Number(amount);

  if (amt < CONFIG.MIN_WTH) return res.json({ success: false, message: `Min withdrawal is ${CONFIG.MIN_WTH} ETB!` });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uRes = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [cleanId]);
    if (uRes.rows.length === 0) { await client.query('ROLLBACK'); return res.json({ success: false, message: 'User not found!' }); }

    const u = uRes.rows[0];
    if (parseFloat(u.balance) < amt) { await client.query('ROLLBACK'); return res.json({ success: false, message: 'Insufficient balance!' }); }
    if (u.first_deposit_completed !== 'YES' && parseFloat(u.total_deposited) < CONFIG.MIN_FIRST_DEP) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: `Deposit ${CONFIG.MIN_FIRST_DEP} ETB first to unlock withdrawals!` });
    }

    const newBal = Number((parseFloat(u.balance) - amt).toFixed(2));
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

// 👥 Live Agents Endpoint
app.get('/api/agents', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM agents');
    res.json({ success: true, agents: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Hulu Bet Server running on port ${PORT}`));
