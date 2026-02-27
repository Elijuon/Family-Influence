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

/* AUTH */
app.post("/api/auth", async (req, res) => {
  const { telegram_id, first_name, last_name } = req.body;

  const { data, error } = await supabase
    .from("users")
    .upsert({ telegram_id, first_name, last_name })
    .select()
    .single();

  if (error) return res.status(500).json(error);
  res.json(data);
});

/* AVATAR */
app.get("/api/avatar/:id", async (req, res) => {
  const { data } = await supabase
    .from("users")
    .select("avatar_url")
    .eq("telegram_id", req.params.id)
    .single();

  res.json({ url: data?.avatar_url || null });
});

/* FAMILIES COUNT */
app.get("/api/families/count", async (req, res) => {
  const { count } = await supabase
    .from("families")
    .select("*", { count: "exact", head: true });

  res.json({ count });
});

/* TASKS */
app.get("/api/tasks", async (req, res) => {
  const { family_id } = req.query;

  const { data } = await supabase
    .from("tasks")
    .select("*")
    .eq("family_id", family_id)
    .order("deadline", { ascending: true });

  res.json(data || []);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
