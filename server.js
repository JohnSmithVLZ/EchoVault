const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static('public'));

const ALLOWED_TAGS = ['idea', 'problem', 'question', 'other'];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const USER_PASSWORD = process.env.USER_PASSWORD;

if (!ADMIN_PASSWORD || !USER_PASSWORD) {
  console.error('ОШИБКА: ADMIN_PASSWORD или USER_PASSWORD не заданы!');
  process.exit(1);
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ideas (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT 'idea',
      likes INTEGER NOT NULL DEFAULT 0,
      resolved BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE ideas
      ADD COLUMN IF NOT EXISTS tag TEXT NOT NULL DEFAULT 'idea',
      ADD COLUMN IF NOT EXISTS likes INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS likes (
      idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

// Middleware: проверка токена
async function auth(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Требуется вход' });

  try {
    const result = await pool.query('SELECT role FROM sessions WHERE token = $1', [token]);
    if (!result.rows.length) return res.status(401).json({ error: 'Неверный токен' });
    req.role = result.rows[0].role;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Проверка: только админ
function adminOnly(req, res, next) {
  if (req.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  next();
}

// === ВХОД ===
app.post('/api/login', async (req, res) => {
  const password = (req.body.password || '').trim();
  if (!password) return res.status(400).json({ error: 'Введите пароль' });

  let role;
  if (password === ADMIN_PASSWORD) role = 'admin';
  else if (password === USER_PASSWORD) role = 'user';
  else return res.status(401).json({ error: 'Неверный пароль' });

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, role) VALUES ($1, $2)', [token, role]);
  res.json({ token, role });
});

// === ВЫХОД ===
app.post('/api/logout', auth, async (req, res) => {
  const token = req.headers['authorization'];
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ ok: true });
});

// === ИДЕИ ===
app.get('/api/ideas', auth, async (req, res) => {
  try {
    const tag = req.query.tag;
    let query = 'SELECT * FROM ideas';
    const args = [];
    if (tag && ALLOWED_TAGS.includes(tag)) {
      query += ' WHERE tag = $1';
      args.push(tag);
    }
    query += ' ORDER BY resolved ASC, created_at DESC';
    const result = await pool.query(query, args);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ideas', auth, async (req, res) => {
  const text = (req.body.text || '').trim();
  const tag = ALLOWED_TAGS.includes(req.body.tag) ? req.body.tag : 'idea';
  if (!text) return res.status(400).json({ error: 'Пустой текст' });

  try {
    const result = await pool.query(
      'INSERT INTO ideas (text, tag) VALUES ($1, $2) RETURNING *',
      [text, tag]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ideas/:id/like', auth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  try {
    const update = await pool.query(
      'UPDATE ideas SET likes = likes + 1 WHERE id = $1 RETURNING *',
      [id]
    );
    if (!update.rows.length) return res.status(404).json({ error: 'Не найдено' });

    await pool.query('INSERT INTO likes (idea_id) VALUES ($1)', [id]);
    res.json(update.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ТОЛЬКО АДМИН: удалить ===
app.delete('/api/ideas/:id', auth, adminOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  try {
    await pool.query('DELETE FROM ideas WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ТОЛЬКО АДМИН: пометить решённым ===
app.post('/api/ideas/:id/resolve', auth, adminOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const resolved = !!req.body.resolved;
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  try {
    const result = await pool.query(
      'UPDATE ideas SET resolved = $1 WHERE id = $2 RETURNING *',
      [resolved, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Сервер запущен на порту ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Ошибка базы данных:', err);
    process.exit(1);
  });
