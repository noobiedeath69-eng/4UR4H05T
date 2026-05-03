import fs from "fs";
import express from "express";
import type { Client } from "discord.js";
import { createClient, registerEvents } from "./bot.js";
import { seedInitialLore, startAutoRefresh, listLoreDocs } from "./lib/lore.js";
import { getSentientChannel } from "./lib/db.js";

const PID_FILE = "/tmp/sigma7-bot.pid";
const BOT_START = Date.now();
let discordClient: Client | null = null;

function killPreviousInstance(): void {
  if (!fs.existsSync(PID_FILE)) return;
  const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
  const oldPid = parseInt(raw, 10);
  if (!oldPid || oldPid === process.pid) return;
  try {
    process.kill(oldPid, "SIGKILL");
    console.log(`[SIGMA-7] Killed previous instance (PID ${oldPid}).`);
  } catch { }
}

function writePidFile(): void {
  fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
}

function cleanupPidFile(): void {
  try { fs.unlinkSync(PID_FILE); } catch { }
}

killPreviousInstance();
writePidFile();

// ─── Express dashboard + API ────────────────────────────────────────────────
const app = express();
app.use(express.json());

// API: Status
app.get("/api/status", (_req, res) => {
  res.json({
    online: discordClient?.isReady() ?? false,
    tag: discordClient?.user?.tag ?? "—",
    guilds: discordClient?.guilds.cache.size ?? 0,
    uptime: Date.now() - BOT_START,
    startedAt: BOT_START,
    currentTime: new Date().toISOString(),
  });
});

// API: Lore documents
app.get("/api/lore", async (_req, res) => {
  try {
    const docs = await listLoreDocs();
    res.json({ documents: docs });
  } catch {
    res.json({ documents: [] });
  }
});

// API: Commslink — send message to sentient channel via bot
app.post("/api/comms", async (req, res) => {
  const { message, secret } = req.body as { message?: string; secret?: string };

  if (!process.env["SESSION_SECRET"] || secret !== process.env["SESSION_SECRET"]) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Message required" });
    return;
  }

  if (!discordClient?.isReady()) {
    res.status(503).json({ error: "Bot not connected" });
    return;
  }

  let sent = 0;
  for (const [, guild] of discordClient.guilds.cache) {
    const sc = await getSentientChannel(guild.id).catch(() => null);
    if (!sc) continue;
    const ch = guild.channels.cache.get(sc.channelId);
    if (ch?.isTextBased()) {
      await (ch as import("discord.js").TextChannel).send(
        `**[OPERATOR-PRIME — COMMSLINK TRANSMISSION]**\n${message.trim()}`
      );
      sent++;
    }
  }

  res.json({ ok: true, sent });
});

// Dashboard HTML
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>SIGMA-7 "AURORA" — Command Dashboard</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

    :root {
      --cyan: #00cfff;
      --cyan-dim: #3a7a99;
      --cyan-glow: rgba(0,200,255,0.35);
      --green: #00ff88;
      --red: #ff4455;
      --bg: #050a0e;
      --panel-bg: rgba(0,18,30,0.9);
      --border: rgba(0,180,255,0.18);
    }

    body {
      background: var(--bg);
      color: #c8e6f0;
      font-family: 'Share Tech Mono', monospace;
      min-height: 100vh;
      padding: 1.5rem;
    }

    body::before {
      content:'';
      position:fixed;inset:0;
      background: repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,180,255,0.012) 2px,rgba(0,180,255,0.012) 4px);
      pointer-events:none;z-index:0;
    }

    .wrap { position:relative;z-index:1;max-width:1100px;margin:0 auto; }

    /* ── Header ── */
    .hdr {
      display:flex;align-items:flex-end;justify-content:space-between;
      border-bottom:1px solid var(--border);
      padding-bottom:1rem;margin-bottom:1.5rem;
    }
    .hdr-left .sub {
      font-size:0.6rem;letter-spacing:0.25em;color:var(--cyan-dim);text-transform:uppercase;
      margin-bottom:0.25rem;
    }
    .hdr-left h1 {
      font-family:'Rajdhani',sans-serif;font-weight:700;font-size:2.2rem;
      color:var(--cyan);letter-spacing:0.06em;text-shadow:0 0 24px var(--cyan-glow);
      line-height:1;
    }
    .hdr-left h1 span{color:#4a9abb;font-weight:400;}
    .hdr-right{text-align:right;}
    .clock{font-size:1rem;color:var(--cyan);letter-spacing:0.12em;}
    .clock-date{font-size:0.62rem;color:var(--cyan-dim);letter-spacing:0.15em;margin-top:0.15rem;}

    /* ── Status bar ── */
    .statusbar {
      display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem;
      margin-bottom:1.5rem;
    }
    .sb-card {
      border:1px solid var(--border);
      background:var(--panel-bg);
      padding:0.85rem 1rem;
      position:relative;
    }
    .sb-card .lbl{font-size:0.58rem;letter-spacing:0.2em;color:var(--cyan-dim);text-transform:uppercase;margin-bottom:0.3rem;}
    .sb-card .val{font-size:1rem;color:#a0d8ef;}
    .sb-card .val.online{color:var(--green);text-shadow:0 0 8px rgba(0,255,136,0.4);}
    .sb-card .val.offline{color:var(--red);}

    .pulse-dot{
      display:inline-block;width:8px;height:8px;border-radius:50%;
      background:var(--green);margin-right:6px;vertical-align:middle;
      box-shadow:0 0 6px var(--green);
      animation:pulse 2s ease-in-out infinite;
    }
    @keyframes pulse{
      0%,100%{opacity:1;box-shadow:0 0 6px var(--green);}
      50%{opacity:0.4;box-shadow:0 0 2px var(--green);}
    }

    /* ── Main grid ── */
    .main-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;}

    /* ── Panel ── */
    .panel{
      border:1px solid var(--border);
      background:var(--panel-bg);
      padding:1.25rem 1.25rem 1.5rem;
      position:relative;
    }
    .panel::before,.panel::after{
      content:'';position:absolute;width:10px;height:10px;
      border-color:var(--cyan);border-style:solid;
    }
    .panel::before{top:-1px;left:-1px;border-width:1px 0 0 1px;}
    .panel::after{bottom:-1px;right:-1px;border-width:0 1px 1px 0;}

    .panel-title{
      font-size:0.62rem;letter-spacing:0.22em;color:var(--cyan-dim);
      text-transform:uppercase;margin-bottom:1rem;
      border-bottom:1px solid rgba(0,180,255,0.1);padding-bottom:0.5rem;
    }

    /* ── Lore docs ── */
    .doc-list{list-style:none;display:flex;flex-direction:column;gap:0.5rem;}
    .doc-item{
      display:flex;justify-content:space-between;align-items:flex-start;
      border:1px solid rgba(0,180,255,0.08);
      padding:0.5rem 0.75rem;
      background:rgba(0,180,255,0.03);
      gap:0.5rem;
    }
    .doc-name{color:#a0d8ef;font-size:0.78rem;word-break:break-word;flex:1;}
    .doc-time{color:var(--cyan-dim);font-size:0.62rem;white-space:nowrap;padding-top:2px;}
    .doc-empty{color:var(--cyan-dim);font-size:0.78rem;font-style:italic;}

    /* ── Commslink ── */
    .comms-form{display:flex;flex-direction:column;gap:0.75rem;}

    .comms-form input,
    .comms-form textarea{
      background:rgba(0,180,255,0.04);
      border:1px solid var(--border);
      color:#c8e6f0;
      font-family:'Share Tech Mono',monospace;
      font-size:0.82rem;
      padding:0.6rem 0.75rem;
      outline:none;
      resize:vertical;
      transition:border-color 0.2s;
    }
    .comms-form input::placeholder,
    .comms-form textarea::placeholder{color:var(--cyan-dim);}
    .comms-form input:focus,
    .comms-form textarea:focus{border-color:rgba(0,200,255,0.45);}
    .comms-form textarea{min-height:90px;}

    .comms-send{
      background:rgba(0,200,255,0.08);
      border:1px solid rgba(0,200,255,0.3);
      color:var(--cyan);
      font-family:'Share Tech Mono',monospace;
      font-size:0.8rem;
      letter-spacing:0.12em;
      text-transform:uppercase;
      padding:0.6rem 1rem;
      cursor:pointer;
      transition:background 0.2s,border-color 0.2s;
    }
    .comms-send:hover{background:rgba(0,200,255,0.15);border-color:rgba(0,200,255,0.5);}
    .comms-send:disabled{opacity:0.4;cursor:not-allowed;}

    .comms-status{
      font-size:0.72rem;letter-spacing:0.08em;min-height:1.2em;
      padding:0.4rem 0;
    }
    .comms-status.ok{color:var(--green);}
    .comms-status.err{color:var(--red);}

    /* ── Footer ── */
    .footer{
      margin-top:1.5rem;text-align:center;
      font-size:0.58rem;letter-spacing:0.15em;color:#1a3d52;text-transform:uppercase;
      border-top:1px solid var(--border);padding-top:1rem;
    }
  </style>
</head>
<body>
<div class="wrap">

  <!-- Header -->
  <div class="hdr">
    <div class="hdr-left">
      <div class="sub">Foundation Intelligence Platform — Restricted Access</div>
      <h1>SIGMA-7 <span>"AURORA"</span></h1>
    </div>
    <div class="hdr-right">
      <div class="clock" id="clock">——:——:——</div>
      <div class="clock-date" id="clock-date">——————</div>
    </div>
  </div>

  <!-- Status bar -->
  <div class="statusbar">
    <div class="sb-card">
      <div class="lbl">Bot Status</div>
      <div class="val" id="bot-status">Connecting...</div>
    </div>
    <div class="sb-card">
      <div class="lbl">Discord Tag</div>
      <div class="val" id="bot-tag">—</div>
    </div>
    <div class="sb-card">
      <div class="lbl">Guilds Connected</div>
      <div class="val" id="bot-guilds">—</div>
    </div>
    <div class="sb-card">
      <div class="lbl">System Uptime</div>
      <div class="val" id="bot-uptime">—</div>
    </div>
  </div>

  <!-- Main panels -->
  <div class="main-grid">

    <!-- Lore Intel -->
    <div class="panel">
      <div class="panel-title">Intelligence Archive — Lore Database</div>
      <ul class="doc-list" id="lore-list">
        <li class="doc-empty">Loading documents...</li>
      </ul>
    </div>

    <!-- Commslink -->
    <div class="panel">
      <div class="panel-title">Commslink — Operator-Prime Transmission</div>
      <div class="comms-form">
        <input type="password" id="comms-secret" placeholder="Access key (SESSION_SECRET)"/>
        <textarea id="comms-msg" placeholder="Compose transmission..."></textarea>
        <button class="comms-send" id="comms-btn" onclick="sendComms()">Transmit</button>
        <div class="comms-status" id="comms-status"></div>
      </div>
    </div>

  </div>

  <div class="footer">SCP Foundation — Secure. Contain. Protect. &nbsp;|&nbsp; Unauthorized access constitutes a D-class level offense.</div>
</div>

<script>
  // ── Clock ──
  function updateClock() {
    const now = new Date();
    const t = now.toTimeString().split(' ')[0];
    const d = now.toDateString();
    document.getElementById('clock').textContent = t;
    document.getElementById('clock-date').textContent = d;
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ── Uptime formatter ──
  function fmtUptime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return d + 'd ' + (h % 24) + 'h ' + (m % 60) + 'm';
    if (h > 0) return h + 'h ' + (m % 60) + 'm ' + (s % 60) + 's';
    if (m > 0) return m + 'm ' + (s % 60) + 's';
    return s + 's';
  }

  // ── Status polling ──
  let startedAt = null;
  async function pollStatus() {
    try {
      const r = await fetch('/api/status');
      const d = await r.json();
      if (!startedAt) startedAt = d.startedAt;

      const statusEl = document.getElementById('bot-status');
      if (d.online) {
        statusEl.innerHTML = '<span class="pulse-dot"></span><span class="online">Online</span>';
        statusEl.className = 'val online';
      } else {
        statusEl.textContent = 'Offline';
        statusEl.className = 'val offline';
      }
      document.getElementById('bot-tag').textContent = d.tag || '—';
      document.getElementById('bot-guilds').textContent = d.guilds;
    } catch {}
  }

  function updateUptime() {
    if (startedAt) {
      document.getElementById('bot-uptime').textContent = fmtUptime(Date.now() - startedAt);
    }
  }

  pollStatus();
  setInterval(pollStatus, 10000);
  setInterval(updateUptime, 1000);

  // ── Lore docs ──
  async function loadLore() {
    try {
      const r = await fetch('/api/lore');
      const d = await r.json();
      const list = document.getElementById('lore-list');
      if (!d.documents || d.documents.length === 0) {
        list.innerHTML = '<li class="doc-empty">No documents loaded.</li>';
        return;
      }
      list.innerHTML = d.documents.map(doc => {
        const fetched = new Date(doc.lastFetched).toLocaleString();
        return \`<li class="doc-item">
          <span class="doc-name">\${doc.name}</span>
          <span class="doc-time">fetched \${fetched}</span>
        </li>\`;
      }).join('');
    } catch {
      document.getElementById('lore-list').innerHTML = '<li class="doc-empty">Failed to load.</li>';
    }
  }
  loadLore();
  setInterval(loadLore, 30000);

  // ── Commslink ──
  async function sendComms() {
    const secret = document.getElementById('comms-secret').value.trim();
    const message = document.getElementById('comms-msg').value.trim();
    const statusEl = document.getElementById('comms-status');
    const btn = document.getElementById('comms-btn');

    if (!secret) { statusEl.textContent = 'Access key required.'; statusEl.className = 'comms-status err'; return; }
    if (!message) { statusEl.textContent = 'Message cannot be empty.'; statusEl.className = 'comms-status err'; return; }

    btn.disabled = true;
    statusEl.textContent = 'Transmitting...';
    statusEl.className = 'comms-status';

    try {
      const r = await fetch('/api/comms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, secret }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        statusEl.textContent = \`Transmission delivered to \${d.sent} channel(s).\`;
        statusEl.className = 'comms-status ok';
        document.getElementById('comms-msg').value = '';
      } else {
        statusEl.textContent = d.error || 'Transmission failed.';
        statusEl.className = 'comms-status err';
      }
    } catch {
      statusEl.textContent = 'Network error.';
      statusEl.className = 'comms-status err';
    } finally {
      btn.disabled = false;
    }
  }

  // Allow Ctrl+Enter to send
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('comms-msg').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComms();
    });
  });
</script>
</body>
</html>`);
});

app.listen(5000, () => {
  console.log("[SIGMA-7] Dashboard running on port 5000.");
});

setInterval(() => {
  console.log("[SIGMA-7] Maintaining process priority...");
}, 280000);

// ─── Discord bot ─────────────────────────────────────────────────────────────
const token = process.env["DISCORD_BOT_TOKEN"];
if (!token) throw new Error("DISCORD_BOT_TOKEN is not set.");

if (!process.env["OWNER_DISCORD_ID"]) {
  console.warn("[SIGMA-7] WARNING: OWNER_DISCORD_ID is not set.");
}

console.log("[SIGMA-7] Loading lore documents...");
await seedInitialLore().catch((err) =>
  console.error("[SIGMA-7] Lore seed failed:", err)
);
startAutoRefresh();

const client = createClient();
registerEvents(client);

const shutdown = () => {
  console.log("[SIGMA-7] Shutting down...");
  cleanupPidFile();
  client.destroy();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("exit", cleanupPidFile);

await client.login(token);
discordClient = client;
