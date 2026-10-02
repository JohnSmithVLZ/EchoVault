const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static('public'));

const ALLOWED_TAGS = ['idea', 'problem', 'question', 'other'];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ideas (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT 'idea',
      likes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE ideas
      ADD COLUMN IF NOT EXISTS tag TEXT NOT NULL DEFAULT 'idea',
      ADD COLUMN IF NOT EXISTS likes INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS likes (
      idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

app.get('/api/ideas', async (req, res) => {
  try {
    const tag = req.query.tag;
    let query = 'SELECT * FROM ideas';
    const args = [];
    if (tag && ALLOWED_TAGS.includes(tag)) {
      query += ' WHERE tag = $1';
      args.push(tag);
    }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, args);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ideas', async (req, res) => {
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

app.post('/api/ideas/:id/like', async (req, res) => {
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
