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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов с одного IP
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

/* =======================
   DEBUG ENV
======================= */

console.log("ENV CHECK:");
console.log("SUPABASE_URL:", SUPABASE_URL ? "OK" : "MISSING");
console.log("SUPABASE_SECRET:", SUPABASE_SECRET ? "OK" : "MISSING");
console.log("TELEGRAM_TOKEN:", TELEGRAM_TOKEN ? "OK" : "MISSING");

if (!SUPABASE_URL || !SUPABASE_SECRET || !TELEGRAM_TOKEN) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

/* =======================
   Clients
======================= */

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

/* =======================
   HEALTH
======================= */

app.get("/health", (req, res) => {
  res.send("OK");
});

/* =======================
   AUTH (без middleware, прямой эндпоинт)
======================= */

app.post("/api/auth", async (req, res) => {
  const { telegram_id, first_name, last_name } = req.body;

  if (!telegram_id) {
    return res.status(400).json({ error: "telegram_id is required" });
  }

  try {
    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegram_id)
      .single();

    if (!user) {
      // Пользователь новый – создаём без семьи
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
    console.error("Auth error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   FAMILIES
======================= */

// Создание семьи
app.post("/api/families", async (req, res) => {
  const { name, user_id } = req.body;

  if (!name || !user_id) {
    return res.status(400).json({ error: "name and user_id are required" });
  }

  try {
    const invite_code = Math.random().toString(36).substring(7);
    const { data: family, error: familyError } = await supabase
      .from("families")
      .insert({ name, invite_code })
      .select()
      .single();

    if (familyError) throw familyError;

    const { error: userError } = await supabase
      .from("users")
      .update({ family_id: family.id })
      .eq("id", user_id);

    if (userError) throw userError;

    res.json({ ...family, invite_code });
  } catch (err) {
    console.error("Create family error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Присоединение по коду
app.post("/api/families/join", async (req, res) => {
  const { invite_code, user_id } = req.body;

  if (!invite_code || !user_id) {
    return res.status(400).json({ error: "invite_code and user_id are required" });
  }

  try {
    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id")
      .eq("invite_code", invite_code)
      .single();

    if (familyError || !family) {
      return res.status(404).json({ error: "Family not found" });
    }

    const { error: userError } = await supabase
      .from("users")
      .update({ family_id: family.id })
      .eq("id", user_id);

    if (userError) throw userError;

    res.json({ id: family.id });
  } catch (err) {
    console.error("Join family error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Получение информации о семье (код приглашения)
app.get("/api/families/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data: family, error } = await supabase
      .from("families")
      .select("invite_code")
      .eq("id", id)
      .single();

    if (error || !family) {
      return res.status(404).json({ error: "Family not found" });
    }

    res.json({ invite_code: family.invite_code });
  } catch (err) {
    console.error("Get family error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Количество семей
app.get("/api/families/count", async (req, res) => {
  try {
    const { count } = await supabase
      .from("families")
      .select("*", { count: "exact", head: true });

    res.json({ count: count || 0 });
  } catch (err) {
    console.error("Count families error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   USERS (участники семьи)
======================= */

app.get("/api/users", async (req, res) => {
  const { family_id } = req.query;

  if (!family_id) {
    return res.json([]);
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, first_name, last_name")
      .eq("family_id", family_id);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   TASKS
======================= */

app.get("/api/tasks", async (req, res) => {
  const { family_id } = req.query;

  if (!family_id) {
    return res.json([]);
  }

  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("family_id", family_id)
      .order("deadline", { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("Get tasks error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  const { title, description, deadline, family_id, assignee_id, creator_id } = req.body;

  if (!title || !deadline || !family_id) {
    return res.status(400).json({ error: "title, deadline, family_id are required" });
  }

  try {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title,
        description: description || null,
        deadline,
        family_id,
        assignee_id: assignee_id || null,
        creator_id: creator_id || null
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Create task error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Delete task error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   WISHES
======================= */

app.get("/api/wishes", async (req, res) => {
  const { family_id } = req.query;

  if (!family_id) {
    return res.json([]);
  }

  try {
    const { data, error } = await supabase
      .from("wishes")
      .select(`
        *,
        user:users(id, first_name, last_name)
      `)
      .eq("family_id", family_id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("Get wishes error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/wishes", async (req, res) => {
  const { title, description, link, user_id, family_id } = req.body;

  if (!title || !user_id || !family_id) {
    return res.status(400).json({ error: "title, user_id, family_id are required" });
  }

  try {
    const { data, error } = await supabase
      .from("wishes")
      .insert({
        title,
        description: description || null,
        link: link || null,
        user_id,
        family_id
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Create wish error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/wishes/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from("wishes")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Delete wish error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   AVATAR через Telegram Bot API
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
   BOT COMMANDS
======================= */

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `👋 Привет, ${msg.from.first_name}!\nОткрой мини-приложение в меню.`
  );
});

/* =======================
   START SERVER
======================= */

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
