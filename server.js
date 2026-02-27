import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import TelegramBot from 'node-telegram-bot-api';
import crypto from 'crypto';

import { supabase } from './lib/supabase.js';
import { authMiddleware } from './middleware/auth.js';

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100
  })
);

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: true
});

app.get('/health', (req, res) => {
  res.send('OK');
});

app.post('/api/auth', authMiddleware, (req, res) => {
  res.json(req.user);
});

app.post('/api/families', authMiddleware, async (req, res) => {
  const { name } = req.body;

  const invite_code = crypto.randomUUID();

  const { data: family, error } = await supabase
    .from('families')
    .insert({ name, invite_code })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase
    .from('users')
    .update({ family_id: family.id })
    .eq('id', req.user.id);

  res.json(family);
});

app.post('/api/families/join', authMiddleware, async (req, res) => {
  const { invite_code } = req.body;

  const { data: family } = await supabase
    .from('families')
    .select('*')
    .eq('invite_code', invite_code)
    .single();

  if (!family) return res.status(404).json({ error: 'Family not found' });

  await supabase
    .from('users')
    .update({ family_id: family.id })
    .eq('id', req.user.id);

  res.json(family);
});

app.get('/api/tasks', authMiddleware, async (req, res) => {
  if (!req.user.family_id)
    return res.status(403).json({ error: 'No family' });

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('family_id', req.user.family_id)
    .eq('status', 'active')
    .order('deadline');

  res.json(tasks);
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
  const { title, description, assignee_id, deadline } = req.body;

  if (!req.user.family_id)
    return res.status(403).json({ error: 'No family' });

  const { data: task } = await supabase
    .from('tasks')
    .insert({
      title,
      description,
      assignee_id,
      creator_id: req.user.id,
      family_id: req.user.family_id,
      deadline,
      status: 'active'
    })
    .select()
    .single();

  const { data: assignee } = await supabase
    .from('users')
    .select('telegram_id')
    .eq('id', assignee_id)
    .single();

  if (assignee) {
    bot.sendMessage(
      assignee.telegram_id,
      `🔔 Новая задача: ${title}`
    );
  }

  res.json(task);
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (!task || task.creator_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await supabase
    .from('tasks')
    .delete()
    .eq('id', id);

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
