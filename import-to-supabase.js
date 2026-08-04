// Seed Supabase from the WEDGE//PLAN export.
//
//   npm i @supabase/supabase-js
//   export SUPABASE_URL=...            # project URL
//   export SUPABASE_SERVICE_KEY=...    # service role key, NOT the anon key
//   node import-to-supabase.js wedge-export.json
//
// Run the schema in wedge-schema.sql first.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY first.");
  process.exit(1);
}

const file = process.argv[2] || "wedge-export.json";
const data = JSON.parse(readFileSync(file, "utf8"));
const db = createClient(url, key);

// Everything logged Aug 3–4 2026 was range balls off a mat with the Launch Pro.
// Adjust if that's wrong — it matters for filtering later.
const DEFAULTS = { ball_type: "range", surface: "mat" };

const shots = (data.shots || []).map(s => ({
  club: s.club,
  feel: s.feel,
  carry: s.carry,
  grip_choke_in: s.grip_choke_in ?? 0,
  ball_type: s.ball_type ?? DEFAULTS.ball_type,
  surface: s.surface ?? DEFAULTS.surface,
  hit_on: s.hit_on,
}));

const lag = (data.lag_sessions || []).map(l => ({
  distance_ft: l.distance_ft,
  in_zone: l.in_zone,
  of_putts: l.of ?? 10,
}));

async function insert(table, rows) {
  if (!rows.length) return console.log(`${table}: nothing to insert`);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from(table).insert(chunk);
    if (error) {
      console.error(`${table} failed at row ${i}:`, error.message);
      process.exit(1);
    }
  }
  console.log(`${table}: inserted ${rows.length}`);
}

await insert("shots", shots);
await insert("lag_sessions", lag);

const { data: view, error } = await db.from("stock_rolling_50").select("*");
if (error) {
  console.error("View read failed — did you run wedge-schema.sql?", error.message);
} else {
  console.log("\nRolling 50 by stock:");
  console.table(view);
}
