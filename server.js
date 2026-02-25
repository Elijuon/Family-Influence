import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import TelegramBot from 'node-telegram-bot-api';

const app = express();
app.use(cors());
app.use(express.json());

// ВАШИ ДАННЫЕ (уже вставлены)
const SUPABASE_URL = 'https://itcbseurweugqeibgdmy.supabase.co';
const SUPABASE_SECRET = 'sb_secret_gPbZ9PLB1aOLRRSt2Tye2w_zVdi7_jq';
const TELEGRAM_TOKEN = '8693344253:AAFz8yqVWIJ8nLvYqSkL0Pcrola6oTws2ok';

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

app.get('/health', (req, res) => {
  res.send('OK');
});

app.post('/api/auth', async (req, res) => {
  const { telegram_id, first_name, last_name } = req.body;
  
  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegram_id)
    .single();
  
  if (!user) {
    const { data: newUser } = await supabase
      .from('users')
      .insert({ telegram_id, first_name, last_name })
      .select()
      .single();
    user = newUser;
  }
  
  res.json(user);
});

app.post('/api/families', async (req, res) => {
  const { name, user_id } = req.body;
  const invite_code = Math.random().toString(36).substring(7);
  
  const { data: family } = await supabase
    .from('families')
    .insert({ name, invite_code })
    .select()
    .single();
  
  await supabase
    .from('users')
    .update({ family_id: family.id })
    .eq('id', user_id);
  
  res.json({ ...family, invite_code });
});

app.post('/api/families/join', async (req, res) => {
  const { invite_code, user_id } = req.body;
  
  const { data: family } = await supabase
    .from('families')
    .select('*')
    .eq('invite_code', invite_code)
    .single();
  
  if (family) {
    await supabase
      .from('users')
      .update({ family_id: family.id })
      .eq('id', user_id);
    res.json(family);
  } else {
    res.status(404).json({ error: 'Семья не найдена' });
  }
});

app.get('/api/tasks', async (req, res) => {
  const { family_id } = req.query;
  
  const { data: tasks } = await supabase
    .from('tasks')
    .select(`
      *,
      assignee:users!assignee_id(first_name, last_name),
      creator:users!creator_id(first_name, last_name)
    `)
    .eq('family_id', family_id)
    .order('deadline', { ascending: true });
  
  res.json(tasks);
});

app.post('/api/tasks', async (req, res) => {
  const { title, description, assignee_id, creator_id, family_id, deadline } = req.body;
  
  const { data: task } = await supabase
    .from('tasks')
    .insert({ title, description, assignee_id, creator_id, family_id, deadline })
    .select()
    .single();
  
  const { data: user } = await supabase
    .from('users')
    .select('telegram_id')
    .eq('id', assignee_id)
    .single();
  
  if (user) {
    bot.sendMessage(
      user.telegram_id,
      `🔔 Новая задача: *${title}*\nСделать до: ${new Date(deadline).toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  }
  
  res.json(task);
});

app.get('/api/wishes', async (req, res) => {
  const { family_id } = req.query;
  
  const { data: wishes } = await supabase
    .from('wishes')
    .select(`
      *,
      user:users(first_name, last_name)
    `)
    .eq('family_id', family_id);
  
  res.json(wishes);
});

app.post('/api/wishes', async (req, res) => {
  const { title, description, link, user_id, family_id } = req.body;
  
  const { data: wish } = await supabase
    .from('wishes')
    .insert({ title, description, link, user_id, family_id })
    .select()
    .single();
  
  res.json(wish);
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `👋 Привет, ${msg.from.first_name}!\n\nЯ бот для семейных задач. Открой приложение по кнопке меню ниже 👇`
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});