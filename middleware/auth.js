import { supabase } from '../lib/supabase.js';

export async function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];

  if (!initData) {
    return res.status(401).json({ error: 'No init data' });
  }

  const params = new URLSearchParams(initData);
  const userRaw = params.get('user');

  if (!userRaw) {
    return res.status(401).json({ error: 'No user in init data' });
  }

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
}
