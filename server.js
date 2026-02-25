import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import TelegramBot from 'node-telegram-bot-api';

const app = express();
app.use(cors());
app.use(express.json());

// ВАШИ ДАННЫЕ
const SUPABASE_URL = 'https://itcbseurweugqeibgdmy.supabase.co';
const SUPABASE_SECRET = 'sb_secret_gPbZ9PLB1aOLRRSt2Tye2w_zVdi7_jq';
const TELEGRAM_TOKEN = '8693344253:AAFz8yqVWIJ8nLvYqSkL0Pcrola6oTws2ok';

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Эндпоинт для проверки здоровья (чтоб не засыпал)
app.get('/health', (req, res) => {
  res.send('OK');
});

// АВТОРИЗАЦИЯ ПОЛЬЗОВАТЕЛЯ
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

// ПОЛУЧЕНИЕ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ СЕМЬИ
app.get('/api/users', async (req, res) => {
  const { family_id } = req.query;
  
  const { data: users } = await supabase
    .from('users')
    .select('id, telegram_id, first_name, last_name')
    .eq('family_id', family_id);
  
  res.json(users || []);
});

// СОЗДАНИЕ СЕМЬИ
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

// ПРИСОЕДИНЕНИЕ К СЕМЬЕ
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

// ПОЛУЧЕНИЕ ЗАДАЧ СЕМЬИ
app.get('/api/tasks', async (req, res) => {
  const { family_id } = req.query;
  
  const { data: tasks } = await supabase
    .from('tasks')
    .select(`
      *,
      assignee:users!assignee_id(id, first_name, last_name),
      creator:users!creator_id(id, first_name, last_name)
    `)
    .eq('family_id', family_id)
    .eq('status', 'active')
    .order('deadline', { ascending: true });
  
  res.json(tasks);
});

// СОЗДАНИЕ ЗАДАЧИ
app.post('/api/tasks', async (req, res) => {
  const { title, description, assignee_id, creator_id, family_id, deadline } = req.body;
  
  const { data: task } = await supabase
    .from('tasks')
    .insert({ 
      title, 
      description, 
      assignee_id, 
      creator_id, 
      family_id, 
      deadline,
      status: 'active'
    })
    .select()
    .single();
  
  // Отправляем уведомление исполнителю
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

// УДАЛЕНИЕ ЗАДАЧИ (для кнопок "Выполнено" и "Удалить")
app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id);
  
  if (error) {
    res.status(500).json({ error: error.message });
  } else {
    res.json({ success: true });
  }
});

// ПОЛУЧЕНИЕ ЖЕЛАНИЙ СЕМЬИ
app.get('/api/wishes', async (req, res) => {
  const { family_id } = req.query;
  
  const { data: wishes } = await supabase
    .from('wishes')
    .select(`
      *,
      user:users(id, first_name, last_name)
    `)
    .eq('family_id', family_id)
    .order('created_at', { ascending: false });
  
  res.json(wishes);
});

// ДОБАВЛЕНИЕ ЖЕЛАНИЯ
app.post('/api/wishes', async (req, res) => {
  const { title, description, link, user_id, family_id } = req.body;
  
  const { data: wish } = await supabase
    .from('wishes')
    .insert({ title, description, link, user_id, family_id })
    .select()
    .single();
  
  res.json(wish);
});

// УДАЛЕНИЕ ЖЕЛАНИЯ (НОВЫЙ ЭНДПОИНТ!)
app.delete('/api/wishes/:id', async (req, res) => {
  const { id } = req.params;
  
  const { error } = await supabase
    .from('wishes')
    .delete()
    .eq('id', id);
  
  if (error) {
    res.status(500).json({ error: error.message });
  } else {
    res.json({ success: true });
  }
});

// Обработка команды /start в боте
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
