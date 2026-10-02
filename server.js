const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'ideas.json');

app.use(express.json());
app.use(express.static('public'));

function loadIdeas() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveIdeas(ideas) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(ideas, null, 2));
}

app.get('/api/ideas', (req, res) => {
  res.json(loadIdeas());
});

app.post('/api/ideas', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Пустой текст' });

  const ideas = loadIdeas();
  const idea = {
    id: Date.now(),
    text,
    created_at: new Date().toISOString()
  };
  ideas.unshift(idea);
  saveIdeas(ideas);
  res.json(idea);
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
