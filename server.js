require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

// Проверка переменных окружения
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ==================== AUTH ====================

app.post("/api/auth", async (req, res) => {
  const { telegram_id, first_name, last_name } = req.body;

  // Ищем пользователя
  const { data: existingUser } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .single();

  if (existingUser) {
    return res.json(existingUser);
  }

  // Создаём новую семью
  const inviteCode = Math.random().toString(36).substring(7);
  const { data: family, error: familyError } = await supabase
    .from("families")
    .insert([{ name: "Семья", invite_code: inviteCode }])
    .select()
    .single();

  if (familyError) {
    console.error("Ошибка создания семьи:", familyError);
    return res.status(500).json({ error: "Ошибка создания семьи" });
  }

  // Создаём пользователя
  const { data: newUser, error: userError } = await supabase
    .from("users")
    .insert([{
      telegram_id,
      first_name,
      last_name,
      family_id: family.id
    }])
    .select()
    .single();

  if (userError) {
    console.error("Ошибка создания пользователя:", userError);
    return res.status(500).json({ error: "Ошибка создания пользователя" });
  }

  res.json(newUser);
});

// ==================== FAMILIES ====================

app.get("/api/families/count", async (req, res) => {
  const { count } = await supabase
    .from("families")
    .select("*", { count: "exact", head: true });

  res.json({ count: count || 0 });
});

// ==================== TASKS ====================

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
  const { title, description, deadline, family_id } = req.body;

  if (!title || !deadline || !family_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert([{
      title,
      description: description || null,
      deadline,
      family_id,
      assignee_id: null, // можно доработать позже
      creator_id: null
    }])
    .select()
    .single();

  if (error) {
    console.error("Ошибка создания задачи:", error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// ==================== AVATAR (заглушка) ====================

app.get("/api/avatar/:id", (req, res) => {
  res.json({ url: null });
});

// ==================== ЗАПУСК ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
