import crypto from 'crypto';
import { supabase } from '../lib/supabase.js';

export async function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];

  if (!initData) {
    return res.status(401).json({ error: 'No Telegram init data' });
  }

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');

  const dataCheckString = [...urlParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = crypto
    .createHash('sha256')
    .update(process.env.TELEGRAM_TOKEN)
    .digest();

  const hmac = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  if (hmac !== hash) {
    return res.status(403).json({ error: 'Invalid Telegram signature' });
  }

  const userData = JSON.parse(urlParams.get('user'));

  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', userData.id)
    .single();

  if (!user) {
    const { data: newUser } = await supabase
      .from('users')
      .insert({
        telegram_id: userData.id,
        first_name: userData.first_name,
        last_name: userData.last_name || ''
      })
      .select()
      .single();

    user = newUser;
  }

  req.user = user;
  next();
}
