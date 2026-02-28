import crypto from 'crypto';
import { supabase } from '../lib/supabase.js';

// Функция для проверки подписи данных от Telegram
function verifyTelegramData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  const dataCheck = [];
  params.sort();
  for (const [key, value] of params) {
    if (key !== 'hash') {
      dataCheck.push(`${key}=${value}`);
    }
  }

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const _hash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheck.join('\n'))
    .digest('hex');

  return _hash === hash;
}

export async function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];

  if (!initData) {
    return res.status(401).json({ error: 'No init data' });
  }

  // Проверяем подпись (если есть токен в env)
  const botToken = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (botToken && !verifyTelegramData(initData, botToken)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const params = new URLSearchParams(initData);
  const userRaw = params.get('user');

  if (!userRaw) {
    return res.status(401).json({ error: 'No user in init data' });
  }

  try {
    const telegramUser = JSON.parse(userRaw);

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramUser.id)
      .single();

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          telegram_id: telegramUser.id,
          first_name: telegramUser.first_name,
          last_name: telegramUser.last_name || ''
        })
        .select()
        .single();

      user = newUser;
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
