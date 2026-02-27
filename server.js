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

  // Проверяем пользователя
  let { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .single();

  // Если нет — создаём семью и пользователя
  if (!user) {
    const { data: family } = await supabase
      .from("families")
      .insert([{ name: "Семья" }])
      .select()
      .single();

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

  // Обновляем имя
  await supabase
    .from("users")
    .update({ first_name, last_name })
    .eq("telegram_id", telegram_id);

  res.json(user);
});

/* ================= TASKS ================= */

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

  const { data, error } = await supabase
    .from("tasks")
    .insert([{ title, deadline, family_id }])
    .select()
    .single();

  if (error) return res.status(500).json(error);
  res.json(data);
});

/* ================= FAMILY COUNT ================= */

app.get("/api/families/count", async (req, res) => {
  const { count } = await supabase
    .from("families")
    .select("*", { count: "exact", head: true });

  res.json({ count: count || 0 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
