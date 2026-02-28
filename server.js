import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import TelegramBot from "node-telegram-bot-api";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());
app.use(helmet());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

/* =======================
   ENV VARIABLES
======================= */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET =
  process.env.SUPABASE_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_KEY;
const TELEGRAM_TOKEN =
  process.env.TELEGRAM_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

console.log("ENV CHECK:");
console.log("SUPABASE_URL:", SUPABASE_URL ? "OK" : "MISSING");
console.log("SUPABASE_SECRET:", SUPABASE_SECRET ? "OK" : "MISSING");
console.log("TELEGRAM_TOKEN:", TELEGRAM_TOKEN ? "OK" : "MISSING");

if (!SUPABASE_URL || !SUPABASE_SECRET || !TELEGRAM_TOKEN) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

/* =======================
   MIDDLEWARE: проверка авторизации
======================= */

async function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'No init data' });

  // Проверка подписи (упрощённо, можно добавить)
  const params = new URLSearchParams(initData);
  const userRaw = params.get('user');
  if (!userRaw) return res.status(401).json({ error: 'No user data' });

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
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

// Middleware для проверки принадлежности к семье
async function familyAccessMiddleware(req, res, next) {
  const user = req.user;
  const familyId = req.query.family_id || req.body.family_id || req.params.family_id;
  if (!familyId) return res.status(400).json({ error: 'family_id required' });
  if (user.family_id !== parseInt(familyId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

/* =======================
   HEALTH
======================= */
app.get("/health", (req, res) => res.send("OK"));

/* =======================
   AUTH (открытый эндпоинт)
======================= */
app.post("/api/auth", async (req, res) => {
  const { telegram_id, first_name, last_name } = req.body;
  if (!telegram_id) return res.status(400).json({ error: "telegram_id required" });

  try {
    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegram_id)
      .single();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({ telegram_id, first_name, last_name })
        .select()
        .single();
      if (error) throw error;
      user = newUser;
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   FAMILIES (требуют аутентификации)
======================= */
app.post("/api/families", authMiddleware, async (req, res) => {
  const { name } = req.body;
  const user_id = req.user.id;
  if (!name) return res.status(400).json({ error: "name required" });

  try {
    const invite_code = Math.random().toString(36).substring(7);
    const { data: family, error: fErr } = await supabase
      .from("families")
      .insert({ name, invite_code })
      .select()
      .single();
    if (fErr) throw fErr;

    const { error: uErr } = await supabase
      .from("users")
      .update({ family_id: family.id })
      .eq("id", user_id);
    if (uErr) throw uErr;

    res.json({ ...family, invite_code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/families/join", authMiddleware, async (req, res) => {
  const { invite_code } = req.body;
  const user_id = req.user.id;
  if (!invite_code) return res.status(400).json({ error: "invite_code required" });

  try {
    const { data: family, error: fErr } = await supabase
      .from("families")
      .select("id")
      .eq("invite_code", invite_code)
      .single();
    if (fErr || !family) return res.status(404).json({ error: "Family not found" });

    const { error: uErr } = await supabase
      .from("users")
      .update({ family_id: family.id })
      .eq("id", user_id);
    if (uErr) throw uErr;

    res.json({ id: family.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/families/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (req.user.family_id !== parseInt(id))
    return res.status(403).json({ error: "Access denied" });

  try {
    const { data: family, error } = await supabase
      .from("families")
      .select("invite_code")
      .eq("id", id)
      .single();
    if (error) throw error;
    res.json({ invite_code: family.invite_code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/families/count", async (req, res) => {
  try {
    const { count } = await supabase
      .from("families")
      .select("*", { count: "exact", head: true });
    res.json({ count: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   USERS (участники семьи)
======================= */
app.get("/api/users", authMiddleware, familyAccessMiddleware, async (req, res) => {
  const { family_id } = req.query;
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, first_name, last_name, telegram_id")
      .eq("family_id", family_id);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   TASKS
======================= */
app.get("/api/tasks", authMiddleware, familyAccessMiddleware, async (req, res) => {
  const { family_id, limit = 20, offset = 0 } = req.query;
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("family_id", family_id)
      .order("deadline", { ascending: true })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks", authMiddleware, familyAccessMiddleware, async (req, res) => {
  const { title, description, deadline, assignee_id } = req.body;
  const creator_id = req.user.id;
  const family_id = req.body.family_id;

  if (!title || !deadline || !family_id) {
    return res.status(400).json({ error: "title, deadline, family_id required" });
  }

  try {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title,
        description: description || null,
        deadline,
        family_id,
        assignee_id: assignee_id || creator_id,
        creator_id
      })
      .select()
      .single();
    if (error) throw error;

    // Уведомление, если назначено на другого
    if (assignee_id && assignee_id !== creator_id) {
      const { data: assignee } = await supabase
        .from("users")
        .select("telegram_id")
        .eq("id", assignee_id)
        .single();
      if (assignee) {
        bot.sendMessage(
          assignee.telegram_id,
          `🔔 Новая задача: *${title}*\nСделать до: ${new Date(deadline).toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { title, description, deadline, assignee_id } = req.body;
  const userId = req.user.id;

  try {
    // Проверяем, что задача существует и пользователь может её редактировать (создатель или исполнитель)
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchError || !task) return res.status(404).json({ error: "Task not found" });
    if (task.creator_id !== userId && task.assignee_id !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { data, error } = await supabase
      .from("tasks")
      .update({ title, description, deadline, assignee_id })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tasks/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("creator_id, assignee_id")
      .eq("id", id)
      .single();
    if (fetchError || !task) return res.status(404).json({ error: "Task not found" });
    if (task.creator_id !== userId && task.assignee_id !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   WISHES
======================= */
app.get("/api/wishes", authMiddleware, familyAccessMiddleware, async (req, res) => {
  const { family_id, limit = 20, offset = 0 } = req.query;
  try {
    const { data, error } = await supabase
      .from("wishes")
      .select(`
        *,
        user:users(id, first_name, last_name)
      `)
      .eq("family_id", family_id)
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/wishes", authMiddleware, familyAccessMiddleware, async (req, res) => {
  const { title, description, link } = req.body;
  const user_id = req.user.id;
  const family_id = req.body.family_id;

  if (!title || !family_id) {
    return res.status(400).json({ error: "title, family_id required" });
  }

  try {
    const { data, error } = await supabase
      .from("wishes")
      .insert({ title, description: description || null, link: link || null, user_id, family_id })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/wishes/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { title, description, link } = req.body;
  const userId = req.user.id;

  try {
    const { data: wish, error: fetchError } = await supabase
      .from("wishes")
      .select("user_id")
      .eq("id", id)
      .single();
    if (fetchError || !wish) return res.status(404).json({ error: "Wish not found" });
    if (wish.user_id !== userId) return res.status(403).json({ error: "Access denied" });

    const { data, error } = await supabase
      .from("wishes")
      .update({ title, description, link })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/wishes/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: wish, error: fetchError } = await supabase
      .from("wishes")
      .select("user_id")
      .eq("id", id)
      .single();
    if (fetchError || !wish) return res.status(404).json({ error: "Wish not found" });
    if (wish.user_id !== userId) return res.status(403).json({ error: "Access denied" });

    const { error } = await supabase.from("wishes").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   AVATAR
======================= */
app.get("/api/avatar/:telegramId", async (req, res) => {
  const { telegramId } = req.params;
  try {
    const photos = await bot.getUserProfilePhotos(telegramId, { limit: 1 });
    if (photos.total_count > 0) {
      const fileId = photos.photos[0][0].file_id;
      const file = await bot.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      return res.json({ url });
    }
    res.json({ url: null });
  } catch (e) {
    console.error("Avatar error:", e.message);
    res.json({ url: null });
  }
});

/* =======================
   BOT START
======================= */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `👋 Привет, ${msg.from.first_name}!\nОткрой мини-приложение в меню.`
  );
});

app.listen(PORT, () => console.log("🚀 Server running on port", PORT));
