import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import TelegramBot from "node-telegram-bot-api";

const app = express();
app.use(cors());
app.use(express.json());

const {
  SUPABASE_URL,
  SUPABASE_SECRET,
  TELEGRAM_TOKEN,
  PORT = 3000
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SECRET || !TELEGRAM_TOKEN) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
const bot = new TelegramBot(TELEGRAM_TOKEN);

// ------------------ HEALTH ------------------

app.get("/health", (req, res) => {
  res.send("OK");
});

// ------------------ AUTH ------------------

app.post("/api/auth", async (req, res) => {
  const { telegram_id, first_name, last_name } = req.body;

  let { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .single();

  if (!user) {
    const { data: newUser } = await supabase
      .from("users")
      .insert({ telegram_id, first_name, last_name })
      .select()
      .single();
    user = newUser;
  }

  res.json(user);
});

// ------------------ AVATAR ------------------

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
    res.json({ url: null });
  }
});

// ------------------ FAMILIES COUNT ------------------

app.get("/api/families/count", async (req, res) => {
  const { count } = await supabase
    .from("families")
    .select("*", { count: "exact", head: true });

  res.json({ count: count || 0 });
});

// ------------------ TASKS ------------------

app.get("/api/tasks", async (req, res) => {
  const { family_id } = req.query;

  const { data } = await supabase
    .from("tasks")
    .select("*")
    .eq("family_id", family_id)
    .order("deadline", { ascending: true });

  res.json(data || []);
});

app.post("/api/tasks", async (req, res) => {
  const { title, deadline, family_id } = req.body;

  const { data } = await supabase
    .from("tasks")
    .insert({ title, deadline, family_id })
    .select()
    .single();

  res.json(data);
});

// ------------------ START BOT ------------------

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `👋 Привет, ${msg.from.first_name}!\nОткрой мини-приложение в меню.`
  );
});

app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
