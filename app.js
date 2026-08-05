// WEDGE//PLAN — offline-first.
// Every write lands in IndexedDB immediately. Supabase sync is opportunistic:
// if it fails (no signal on the range) the row sits in the queue and goes up later.
// This matters — the range is exactly where reception is worst.

const CFG = window.WEDGE_CONFIG || { SYNC_ENABLED: false };
const CLUBS = ["60", "55", "50"];
const FEELS = [
  { k: "knee",          label: "Knee-high"  },
  { k: "hip",           label: "Hip-high"   },
  { k: "three_quarter", label: "3/4 swing"  },
  { k: "chest",         label: "Chest-high" },
];
const LAGD = [25, 30, 35, 40, 45];
const CAP = 50;              // rolling window
const TARGET = new Date(2026, 8, 5);  // Davis Park Amateur

const today = () => new Date().toISOString().slice(0, 10);
const fmt = d => { const [, m, dd] = d.split("-");
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1] + " " + +dd; };

/* ── IndexedDB ─────────────────────────────────────────────────────── */
let db;
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open("wedge", 1);
  r.onupgradeneeded = () => {
    const d = r.result;
    const s = d.createObjectStore("shots", { keyPath: "id", autoIncrement: true });
    s.createIndex("stock", ["club", "feel"]);
    d.createObjectStore("lag", { keyPath: "id", autoIncrement: true });
    d.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = (store, mode = "readonly") => db.transaction(store, mode).objectStore(store);
const all = store => new Promise(res => { const q = tx(store).getAll(); q.onsuccess = () => res(q.result || []); });
const put = (store, val) => new Promise(res => { const q = tx(store, "readwrite").put(val); q.onsuccess = () => res(q.result); });
const del = (store, id) => new Promise(res => { const q = tx(store, "readwrite").delete(id); q.onsuccess = () => res(); });

/* ── Supabase (thin, no SDK — keeps the bundle at zero) ────────────── */
const sbHeaders = () => ({
  "Content-Type": "application/json",
  apikey: CFG.SUPABASE_ANON_KEY,
  Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY,
});
async function sbInsert(table, row) {
  if (!CFG.SYNC_ENABLED) throw new Error("sync off");
  const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST", headers: sbHeaders(), body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(await r.text());
}
async function flushQueue() {
  if (!CFG.SYNC_ENABLED || !navigator.onLine) return;
  const q = await all("queue");
  for (const item of q) {
    try { await sbInsert(item.table, item.row); await del("queue", item.id); }
    catch { break; }   // stop on first failure, retry the whole tail next time
  }
  render();
}
addEventListener("online", flushQueue);

async function save(table, row) {
  const store = table === "shots" ? "shots" : "lag";
  await put(store, { ...row });
  try { await sbInsert(table, row); }
  catch { await put("queue", { table, row }); }
}

/* ── State ─────────────────────────────────────────────────────────── */
let tab = "map", club = "60", feel = "knee", choke = 0, pd = 25, cur = Array(10).fill(null);
const CHOKES = [0, 1, 2];
// Retired stocks: kept in the data, hidden from the matrix and ladder.
// 55 knee (69yds) sat 2yds off 60 hip (71) — redundant slot, no reason to carry both.
const RETIRED = new Set(["55|knee|0"]);
const key = (c, f, k) => `${c}|${f}|${k}`;
let shots = [], lag = [], queued = 0;

const forStock = (c, f, k = 0) => shots
  .filter(s => s.club === c && s.feel === f && (s.grip_choke_in || 0) === k)
  .sort((a, b) => (a.hit_on < b.hit_on ? -1 : a.hit_on > b.hit_on ? 1 : a.id - b.id))
  .slice(-CAP);

const stat = (c, f, k = 0) => {
  const s = forStock(c, f, k).map(x => x.carry);
  if (!s.length) return null;
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = s.length > 1
    ? Math.sqrt(s.reduce((a, b) => a + (b - avg) ** 2, 0) / (s.length - 1)) : 0;
  return { n: s.length, avg: Math.round(avg), sd: sd.toFixed(1), pct: (100 * sd / avg).toFixed(1),
           range: Math.max(...s) - Math.min(...s) };
};

/* ── Views ─────────────────────────────────────────────────────────── */
function vMap() {
  const st = stat(club, feel, choke), list = forStock(club, feel, choke);
  const retired = RETIRED.has(key(club, feel, choke));
  return `
  <div class="lbl">LOG A SHOT</div>
  <div class="card">
    <div class="lbl">CLUB</div>
    <div class="seg" id="clubseg">${CLUBS.map(c =>
      `<button data-c="${c}" class="${club===c?"on":""}">${c}°</button>`).join("")}</div>
    <div class="lbl">FEEL</div>
    <div class="seg feel" id="feelseg">${FEELS.map(f =>
      `<button data-f="${f.k}" class="${feel===f.k?"on":""}">${f.label}</button>`).join("")}</div>
    <div class="lbl">GRIP</div>
    <div class="seg" id="chokeseg">${CHOKES.map(k =>
      `<button data-k="${k}" class="${choke===k?"on":""}">${k===0?"Full":`Down ${k}"`}</button>`).join("")}</div>
    ${retired ? `<div class="hint" style="color:#c98a2b">Retired stock — logging still works, but it's hidden from the matrix.</div>` : ""}
    <div class="lbl">CARRY FROM LAUNCH PRO</div>
    <div class="inrow">
      <input type="number" inputmode="decimal" id="carry" placeholder="yds">
      <button class="add" id="addbtn">+</button>
    </div>
    ${st ? `
      <div class="avg"><b>${st.avg}</b><span>AVG YDS · ${st.n}/${CAP} · SD ${st.sd} (${st.pct}%)</span></div>
      <div class="bar"><div style="width:${(st.n/CAP)*100}%"></div></div>
      <div class="hint">${st.n>=CAP
        ? `Rolling ${CAP} · ${fmt(list[0].hit_on)} → ${fmt(list[list.length-1].hit_on)} · oldest ages out`
        : `${CAP-st.n} more to fill the window`}</div>
      <div class="chips">${list.slice().reverse().map(s =>
        `<span class="chip ${s.hit_on===today()?"today":""}" data-del="${s.id}">${s.carry}</span>`).join("")}</div>
      <div class="hint">Newest first. Bright = today. Tap to delete a mishit.</div>
    ` : `<div class="hint">No shots yet for this club and feel.</div>`}
  </div>`;
}

function vMatrix() {
  const rows = FEELS.map(f => `<tr><td class="f">${f.label}</td>${CLUBS.map(c => {
    const st = RETIRED.has(key(c, f.k, 0)) ? null : stat(c, f.k, 0);
    return `<td>${st
      ? `<span class="n ${+st.pct>4.5?"wide":""}">${st.avg}<small>${st.n} · ${st.pct}%</small></span>`
      : `<span class="empty">—</span>`}</td>`;
  }).join("")}</tr>`).join("");

  const arr = [];
  CLUBS.forEach(c => FEELS.forEach(f => CHOKES.forEach(k => {
    if (RETIRED.has(key(c, f.k, k))) return;
    const st = stat(c, f.k, k);
    if (st) arr.push({ y: st.avg, l: `${c}° ${f.label}${k ? ` · down ${k}"` : ""}` });
  })));
  arr.sort((a, b) => a.y - b.y);
  const gaps = arr.slice(1).map((x, i) => ({ a: arr[i].y, b: x.y, g: x.y - arr[i].y })).filter(x => x.g > 9);

  return `
  <div class="lbl">YARDAGE MATRIX</div>
  <div class="card" style="padding:8px 12px 12px">
    <table><thead><tr><th style="text-align:left">FEEL</th>${CLUBS.map(c=>`<th>${c}°</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="hint">Percent is SD as a share of carry — the number that means something.
    Amber over 4.5%. Tour sits near 3%. Max-minus-min grows with sample size, so it isn't shown.</div>
  </div>
  ${arr.length ? `<div class="lbl">SHORTEST TO LONGEST</div><div class="card">
    ${arr.map(x=>`<div class="gr"><span style="color:rgba(232,245,232,.6)">${x.l}</span><b style="color:#4ade80">${x.y}yds</b></div>`).join("")}
  </div>` : ""}
  ${gaps.length ? `<div class="gap"><div class="lbl" style="color:#f87171">GAPS OVER 9 YARDS</div>
    ${gaps.map(g=>`<div class="gr"><span>${g.a} → ${g.b}yds</span><span style="color:#f87171">${g.g}yd</span></div>`).join("")}
  </div>` : ""}`;
}

function vPutt() {
  const w = Math.round(pd * 0.1 * 10) / 10;
  const sess = lag.filter(l => l.distance_ft === pd);
  const av = sess.length ? (sess.reduce((a,b)=>a+b.in_zone,0)/sess.length).toFixed(1) : null;
  return `
  <div class="lbl">LAG ZONE — 10% EACH SIDE</div>
  <div class="seg" id="pdseg">${LAGD.map(L=>`<button data-p="${L}" class="${pd===L?"on":""}">${L}</button>`).join("")}</div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
      <div><span style="font-size:22px;font-weight:700">${pd}ft</span></div>
      <div style="text-align:right"><span class="n" style="font-size:18px">${w*2}ft zone</span>
      <small style="display:block;font-size:9px;color:rgba(232,245,232,.35)">${w}ft short · ${w}ft past</small></div>
    </div>
    <div class="lbl">TAP EACH PUTT · IN or OUT</div>
    <div class="dots">${cur.map((s,i)=>
      `<button class="dot ${s===1?"in":s===0?"out":""}" data-dot="${i}">${i+1}</button>`).join("")}</div>
    <div class="avg"><b>${cur.filter(x=>x===1).length}/10</b><span>IN THE ZONE</span></div>
    <div class="tools"><button id="psave">SAVE SET</button><button id="pclear">RESET</button></div>
  </div>
  ${sess.length?`<div class="lbl">${pd}FT · AVG ${av}/10 · ${sess.length} SETS</div>
  <div class="card"><div class="chips">${sess.slice(-12).reverse().map(s=>
    `<span class="chip ${s.in_zone>=7?"today":""}">${s.in_zone}/10</span>`).join("")}</div></div>`:""}`;
}

function vData() {
  return `
  <div class="lbl">DATA</div>
  <div class="card">
    <div class="gr"><span>Shots logged</span><b>${shots.length}</b></div>
    <div class="gr"><span>Lag sets</span><b>${lag.length}</b></div>
    <div class="gr"><span>Sync</span><b>${CFG.SYNC_ENABLED?"on":"local only"}</b></div>
    <div class="gr"><span>Waiting to upload</span><b class="${queued?"q":""}">${queued}</b></div>
  </div>
  <div class="card">
    <div class="lbl">BACKUP</div>
    <button class="primary" id="exp">COPY ALL DATA AS JSON</button>
    <div class="tools"><button id="imp">IMPORT JSON</button><button id="flush">RETRY SYNC</button></div>
    <div class="hint">Export monthly regardless of sync. Free tiers change terms.</div>
  </div>`;
}

/* ── Render + wire ─────────────────────────────────────────────────── */
function render() {
  document.getElementById("cdn").textContent =
    Math.max(0, Math.ceil((TARGET - new Date()) / 864e5));
  const filled = CLUBS.reduce((a,c)=>a+FEELS.reduce((b,f)=>b+(!RETIRED.has(key(c,f.k,0))&&stat(c,f.k,0)?1:0),0),0);
  document.getElementById("sub").textContent =
    `Matrix ${filled}/12 · ${queued ? queued + " queued" : CFG.SYNC_ENABLED ? "synced" : "local"}`;
  document.getElementById("app").innerHTML =
    tab==="map"?vMap():tab==="matrix"?vMatrix():tab==="putt"?vPutt():vData();
  wire();
}

function wire() {
  document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
    tab = b.dataset.t;
    document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
    render();
  });
  document.querySelectorAll("#clubseg button").forEach(b => b.onclick = () => { club = b.dataset.c; render(); });
  document.querySelectorAll("#feelseg button").forEach(b => b.onclick = () => { feel = b.dataset.f; render(); });
  document.querySelectorAll("#chokeseg button").forEach(b => b.onclick = () => { choke = +b.dataset.k; render(); });

  const inp = document.getElementById("carry"), add = document.getElementById("addbtn");
  if (add) {
    const go = async () => {
      const v = parseFloat(inp.value);
      if (isNaN(v) || v <= 0) return;
      await save("shots", { club, feel, carry: Math.round(v), grip_choke_in: choke, hit_on: today() });
      await load(); document.getElementById("carry")?.focus();
    };
    add.onclick = go;
    inp.onkeydown = e => { if (e.key === "Enter") go(); };
    inp.focus();
  }
  document.querySelectorAll("[data-del]").forEach(c => c.onclick = async () => {
    await del("shots", +c.dataset.del); await load();
  });

  document.querySelectorAll("#pdseg button").forEach(b => b.onclick = () => {
    pd = +b.dataset.p; cur = Array(10).fill(null); render();
  });
  document.querySelectorAll("[data-dot]").forEach(b => b.onclick = () => {
    const i = +b.dataset.dot;
    cur[i] = cur[i] === null ? 1 : cur[i] === 1 ? 0 : null;
    render();
  });
  const ps = document.getElementById("psave");
  if (ps) ps.onclick = async () => {
    if (cur.every(x => x === null)) return;
    await save("lag", { distance_ft: pd, in_zone: cur.filter(x => x === 1).length, of_putts: 10, logged_on: today() });
    cur = Array(10).fill(null); await load();
  };
  const pc = document.getElementById("pclear");
  if (pc) pc.onclick = () => { cur = Array(10).fill(null); render(); };

  const ex = document.getElementById("exp");
  if (ex) ex.onclick = () => {
    const txt = JSON.stringify({ exported: new Date().toISOString(), shots, lag_sessions: lag }, null, 2);
    navigator.clipboard?.writeText(txt).then(() => {
      ex.textContent = `COPIED · ${shots.length} SHOTS`;
      setTimeout(() => ex.textContent = "COPY ALL DATA AS JSON", 2000);
    });
  };
  const im = document.getElementById("imp");
  if (im) im.onclick = async () => {
    const raw = prompt("Paste exported JSON");
    if (!raw) return;
    try {
      const p = JSON.parse(raw);
      for (const s of (p.shots || [])) await save("shots", {
        club: String(s.club).replace("°",""), feel: s.feel, carry: s.carry,
        grip_choke_in: s.grip_choke_in || 0, hit_on: s.hit_on || today() });
      for (const l of (p.lag_sessions || [])) await save("lag", {
        distance_ft: l.distance_ft, in_zone: l.in_zone, of_putts: 10, logged_on: today() });
      await load();
    } catch { alert("Could not parse that JSON."); }
  };
  const fl = document.getElementById("flush");
  if (fl) fl.onclick = flushQueue;
}

async function load() {
  [shots, lag] = await Promise.all([all("shots"), all("lag")]);
  queued = (await all("queue")).length;
  render();
}

(async () => { db = await idb(); await load(); flushQueue(); })();
