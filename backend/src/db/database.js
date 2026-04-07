const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const sqlitePath = process.env.SQLITE_PATH || './data/anime-streaming.db';
const resolvedPath = path.resolve(process.cwd(), sqlitePath);

fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const db = new sqlite3.Database(resolvedPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

async function columnExists(tableName, columnName) {
  const columns = await all(`PRAGMA table_info(${tableName})`);
  return columns.some((column) => column.name === columnName);
}

async function ensureColumn(tableName, columnName, sqlDefinition) {
  if (!(await columnExists(tableName, columnName))) {
    await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlDefinition}`);
  }
}

async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      rank TEXT NOT NULL DEFAULT 'Novice',
      is_guest INTEGER NOT NULL DEFAULT 0,
      avatar_seed TEXT,
      age INTEGER,
      last_seen_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureColumn('users', 'avatar_seed', 'TEXT');
  await ensureColumn('users', 'last_seen_at', 'DATETIME');

  await run(`
    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, friend_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(friend_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sender_id, recipient_id),
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS room_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await ensureColumn('room_invites', 'room_id', 'TEXT');

  await run(`
    CREATE TABLE IF NOT EXISTS chat_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direct_pair_key TEXT NOT NULL UNIQUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS anime_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL,
      user_id INTEGER,
      username TEXT NOT NULL,
      body TEXT NOT NULL,
      is_guest INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS room_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      user_id INTEGER,
      username TEXT NOT NULL,
      body TEXT NOT NULL,
      is_guest INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_friendships_user_id ON friendships(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_friendships_friend_id ON friendships(friend_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_friend_requests_sender_id ON friend_requests(sender_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient_id ON friend_requests(recipient_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_friend_requests_status ON friend_requests(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_room_invites_sender_id ON room_invites(sender_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_room_invites_recipient_id ON room_invites(recipient_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_room_invites_status ON room_invites(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_room_invites_room_id ON room_invites(room_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id ON chat_messages(sender_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_anime_comments_anime_id ON anime_comments(anime_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_anime_comments_user_id ON anime_comments(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_room_messages_room_id ON room_messages(room_id)`);

  await run(
    `
      UPDATE users
      SET avatar_seed = COALESCE(NULLIF(avatar_seed, ''), username || '-' || id),
          last_seen_at = COALESCE(last_seen_at, created_at)
    `
  );
}

module.exports = {
  db,
  run,
  get,
  all,
  ensureColumn,
  initializeDatabase,
};
