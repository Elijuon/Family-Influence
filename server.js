import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PORT = 3000
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

app.get("/health", (req, res) => {
  res.send("OK");
});

/* ================= AUTH ================= */

app.post("/api/auth", async (req, res) => {
  const { telegram_id, first_name, last_name } = req.body;

  const { data: existing } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegram_id)
    .single();

  if (existing) return res.json(existing);

  const { data: user, error } = await supabase
    .from("users")
    .insert({ telegram_id, first_name, last_name })
    .select()
    .single();

  if (error) return res.status(500).json({ error });

  res.json(user);
});

/* ================= FAMILIES ================= */

app.get("/api/families/count", async (req, res) => {
  const { count } = await supabase
    .from("families")
    .select("*", { count: "exact", head: true });

  res.json({ count: count || 0 });
});

/* ================= USERS ================= */

app.get("/api/users", async (req, res) => {
  const { family_id } = req.query;

  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .eq("family_id", family_id);

  if (error) return res.status(500).json({ error });

  res.json(data || []);
});

/* ================= TASKS ================= */

app.get("/api/tasks", async (req, res) => {
  const { family_id } = req.query;

  const { data, error } = await supabase
    .from("tasks")
    .select(`
      *,
      assignee:users!assignee_id(id, first_name)
    `)
    .eq("family_id", family_id)
    .order("deadline", { ascending: true });

  if (error) return res.status(500).json({ error });

  res.json(data || []);
});

app.post("/api/tasks", async (req, res) => {
  const { title, description, family_id, assignee_id, deadline } = req.body;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      description,
      family_id,
      assignee_id,
      deadline
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error });

  res.json(data);
});

/* ================= WISHES ================= */

app.get("/api/wishes", async (req, res) => {
  const { family_id } = req.query;

  const { data, error } = await supabase
    .from("wishes")
    .select(`
      *,
      user:users(id, first_name)
    `)
    .eq("family_id", family_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error });

  res.json(data || []);
});

app.post("/api/wishes", async (req, res) => {
  const { title, description, family_id, user_id } = req.body;

  const { data, error } = await supabase
    .from("wishes")
    .insert({
      title,
      description,
      family_id,
      user_id
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error });

  res.json(data);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
