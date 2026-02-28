require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= AUTH ================= */

app.post("/api/auth", async (req, res) => {
  const { telegram_id, first_name, last_name } = req.body;

  // Ищем существующего пользователя
  let { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .single();

  if (!user) {
    // Создаём новую семью с уникальным кодом приглашения
    const invite_code = Math.random().toString(36).substring(7);
    const { data: family } = await supabase
      .from("families")
      .insert([{ name: "Семья", invite_code }])
      .select()
      .single();

    // Создаём пользователя и привязываем к семье
    const { data: newUser } = await supabase
      .from("users")
      .insert([{
        telegram_id,
        first_name,
        last_name,
        family_id: family.id
      }])
      .select()
      .single();

    return res.json(newUser);
  }

  res.json(user);
});

/* ================= TASKS ================= */

app.get("/api/tasks", async (req, res) => {
  const { family_id } = req.query;
  if (!family_id) return res.json([]);

  const { data } = await supabase
    .from("tasks")
    .select("*")
    .eq("family_id", family_id)
    .order("deadline", { ascending: true });

  res.json(data || []);
});

app.post("/api/tasks", async (req, res) => {
  const { title, description, deadline, family_id, assignee_id, creator_id } = req.body;

  const { data, error } = await supabase
    .from("tasks")
    .insert([{ 
      title, 
      description, 
      deadline, 
      family_id,
      assignee_id: assignee_id || null,
      creator_id: creator_id || null
    }])
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

/* ================= WISHES ================= */

app.get("/api/wishes", async (req, res) => {
  const { family_id } = req.query;
  if (!family_id) return res.json([]);

  // Возвращаем желания вместе с данными пользователя, кто создал
  const { data } = await supabase
    .from("wishes")
    .select(`
      *,
      user:users(first_name, last_name)
    `)
    .eq("family_id", family_id)
    .order("created_at", { ascending: false });

  res.json(data || []);
});

app.post("/api/wishes", async (req, res) => {
  const { title, description, link, user_id, family_id } = req.body;

  const { data, error } = await supabase
    .from("wishes")
    .insert([{ title, description, link, user_id, family_id }])
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

/* ================= USERS ================= */

app.get("/api/users", async (req, res) => {
  const { family_id } = req.query;
  if (!family_id) return res.json([]);

  const { data } = await supabase
    .from("users")
    .select("id, first_name, last_name")  // обязательно нужен id
    .eq("family_id", family_id);

  res.json(data || []);
});

/* ================= FAMILIES COUNT ================= */

app.get("/api/families/count", async (req, res) => {
  const { count } = await supabase
    .from("families")
    .select("*", { count: "exact", head: true });

  res.json({ count: count || 0 });
});

/* ================= AVATAR (заглушка) ================= */
// Если хочешь реальные аватарки из Telegram, нужно отдельное решение.
// Пока просто возвращаем пустой объект, чтобы не ломать фронтенд.
app.get("/api/avatar/:id", (req, res) => {
  res.json({ url: null });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port", PORT));
