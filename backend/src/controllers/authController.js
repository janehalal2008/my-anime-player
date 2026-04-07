const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { get, run } = require('../db/database');

const DEFAULT_ROLE = 'user';
const DEFAULT_RANK = 'Novice';
const PASSWORD_SALT_ROUNDS = 12;

function signToken(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET || 'change-this-in-production', {
    expiresIn,
  });
}

function buildAuthResponse(user, expiresIn) {
  const token = signToken(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      rank: user.rank,
      avatar_seed: user.avatar_seed,
      created_at: user.created_at,
      is_guest: Boolean(user.is_guest),
    },
    expiresIn
  );

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      rank: user.rank,
      avatar_seed: user.avatar_seed,
      created_at: user.created_at,
      is_guest: Boolean(user.is_guest),
    },
  };
}

async function touchUser(userId) {
  if (!userId) {
    return;
  }

  await run(`UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`, [userId]);
}

async function register(req, res) {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const age = Number(req.body.age);

    if (!username || !email || !password) {
      res.status(400).json({
        error: 'username, email, and password are required.',
      });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({
        error: 'Password must be at least 8 characters long.',
      });
      return;
    }

    const userCountRow = await get('SELECT COUNT(*) AS total FROM users', []);
    const isFirstRegisteredUser = Number(userCountRow?.total || 0) === 0;
    const assignedRole = isFirstRegisteredUser ? 'admin' : DEFAULT_ROLE;
    const assignedRank = isFirstRegisteredUser ? 'Founder' : DEFAULT_RANK;

    const existingUser = await get(
      `SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1`,
      [email, username]
    );

    if (existingUser) {
      res.status(409).json({
        error: 'A user with this email or username already exists.',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    const avatarSeed = `${username}-${Date.now()}`;
    const result = await run(
      `
        INSERT INTO users (username, email, password_hash, role, rank, is_guest, avatar_seed, age, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [username, email, passwordHash, assignedRole, assignedRank, 0, avatarSeed, age]
    );

    const createdUser = await get(
      `
        SELECT id, username, email, role, rank, is_guest, avatar_seed, created_at
        FROM users
        WHERE id = ?
      `,
      [result.lastID]
    );

    res.status(201).json(buildAuthResponse(createdUser, process.env.JWT_EXPIRES_IN || '7d'));
  } catch (error) {
    res.status(500).json({
      error: 'Unable to register user.',
    });
  }
}

async function login(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const identifier = email || username;

    if (!identifier || !password) {
      res.status(400).json({
        error: 'email or username, and password are required.',
      });
      return;
    }

    const user = await get(
      `
        SELECT id, username, email, password_hash, role, rank, is_guest, avatar_seed, created_at
        FROM users
        WHERE email = ? OR username = ?
        LIMIT 1
      `,
      [identifier.toLowerCase(), identifier]
    );

    if (!user) {
      res.status(401).json({
        error: 'Invalid credentials.',
      });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      res.status(401).json({
        error: 'Invalid credentials.',
      });
      return;
    }

    await touchUser(user.id);
    res.status(200).json(buildAuthResponse(user, process.env.JWT_EXPIRES_IN || '7d'));
  } catch (error) {
    res.status(500).json({
      error: 'Unable to log in.',
    });
  }
}

async function guestLogin(req, res) {
  try {
    const guestName = `guest_${Date.now().toString(36)}`;
    const token = signToken(
      {
        id: null,
        username: guestName,
        email: null,
        role: DEFAULT_ROLE,
        rank: 'Guest',
        avatar_seed: guestName,
        created_at: new Date().toISOString(),
        is_guest: true,
      },
      process.env.GUEST_JWT_EXPIRES_IN || '12h'
    );

    res.status(200).json({
      token,
      user: {
        id: null,
        username: guestName,
        email: null,
        role: DEFAULT_ROLE,
        rank: 'Guest',
        avatar_seed: guestName,
        created_at: new Date().toISOString(),
        is_guest: true,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to create guest session.',
    });
  }
}

module.exports = {
  register,
  login,
  guestLogin,
  touchUser,
};
