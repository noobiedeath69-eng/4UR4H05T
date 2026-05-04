import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import type { Client, TextChannel } from "discord.js";
import { createClient, registerEvents } from "./bot.js";
import { seedInitialLore, startAutoRefresh, listLoreDocs } from "./lib/lore.js";
import { getSentientChannel } from "./lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PID_FILE = "/tmp/sigma7-bot.pid";
const BOT_START = Date.now();
let discordClient: Client | null = null;

function killPreviousInstance(): void {
  if (!fs.existsSync(PID_FILE)) return;
  const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
  const oldPid = parseInt(raw, 10);
  if (!oldPid || oldPid === process.pid) return;
  try { process.kill(oldPid, "SIGKILL"); console.log(`[SIGMA-7] Killed previous instance (PID ${oldPid}).`); } catch { }
}
function writePidFile(): void { fs.writeFileSync(PID_FILE, String(process.pid), "utf-8"); }
function cleanupPidFile(): void { try { fs.unlinkSync(PID_FILE); } catch { } }

killPreviousInstance();
writePidFile();

// ─── In-memory comms history ──────────────────────────────────────────────────
interface CommEntry {
  id: string;
  type: "server" | "dm";
  target: string;
  guildName?: string;
  message: string;
  sentAt: number;
  ok: boolean;
  error?: string;
}
const commsHistory: CommEntry[] = [];
function pushHistory(e: CommEntry) {
  commsHistory.unshift(e);
  if (commsHistory.length > 100) commsHistory.pop();
}

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Serve logo + static assets
const publicDir = path.join(__dirname, "..", "public");
app.use("/static", express.static(publicDir));

// API: Status
app.get("/api/status", (_req, res) => {
  res.json({
    online: discordClient?.isReady() ?? false,
    tag: discordClient?.user?.tag ?? "—",
    guilds: discordClient?.guilds.cache.size ?? 0,
    uptime: Date.now() - BOT_START,
    startedAt: BOT_START,
  });
});

// API: Lore documents
app.get("/api/lore", async (_req, res) => {
  try { res.json({ documents: await listLoreDocs() }); }
  catch { res.json({ documents: [] }); }
});

// API: Guilds — channels + roles (members fetched separately)
app.get("/api/guilds", (_req, res) => {
  if (!discordClient?.isReady()) { res.json({ guilds: [] }); return; }
  const guilds = discordClient.guilds.cache.map((guild) => ({
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL({ size: 32 }) ?? null,
    channels: guild.channels.cache
      .filter((ch) => ch.isTextBased() && ("viewable" in ch ? ch.viewable : true))
      .map((ch) => ({ id: ch.id, name: ch.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    roles: guild.roles.cache
      .filter((r) => r.name !== "@everyone")
      .map((r) => ({ id: r.id, name: r.name }))
      .sort((a, b) => b.position - a.position),
  }));
  res.json({ guilds });
});

// API: Guild members (fetched on demand)
app.get("/api/guilds/:guildId/members", async (req, res) => {
  if (!discordClient?.isReady()) { res.json({ members: [] }); return; }
  const guild = discordClient.guilds.cache.get(req.params.guildId);
  if (!guild) { res.json({ members: [] }); return; }
  try {
    const fetched = await guild.members.fetch({ limit: 200 });
    const members = fetched
      .filter((m) => !m.user.bot)
      .map((m) => ({ id: m.user.id, username: m.user.username, displayName: m.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    res.json({ members });
  } catch { res.json({ members: [] }); }
});

// API: Comms history
app.get("/api/comms/history", (req, res) => {
  const secret = req.headers["x-session-secret"] as string | undefined;
  if (!process.env["SESSION_SECRET"] || secret !== process.env["SESSION_SECRET"]) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  res.json({ history: commsHistory });
});

// API: Send to server channel
app.post("/api/comms", async (req, res) => {
  const { message, secret, guildId, channelId } = req.body as {
    message?: string; secret?: string; guildId?: string; channelId?: string;
  };
  if (!process.env["SESSION_SECRET"] || secret !== process.env["SESSION_SECRET"]) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  if (!message?.trim()) { res.status(400).json({ error: "Message required" }); return; }
  if (!discordClient?.isReady()) { res.status(503).json({ error: "Bot not connected" }); return; }

  const payload = `**[OPERATOR-PRIME — COMMSLINK TRANSMISSION]**\n${message.trim()}`;

  // Targeted send
  if (guildId && channelId) {
    const guild = discordClient.guilds.cache.get(guildId);
    const ch = guild?.channels.cache.get(channelId);
    if (!ch?.isTextBased()) { res.status(404).json({ error: "Channel not found" }); return; }
    try {
      await (ch as TextChannel).send(payload);
      pushHistory({ id: Date.now().toString(), type: "server", target: `#${ch.name}`, guildName: guild?.name, message: message.trim(), sentAt: Date.now(), ok: true });
      res.json({ ok: true, sent: 1 });
    } catch (err: any) {
      pushHistory({ id: Date.now().toString(), type: "server", target: `#${ch.name}`, guildName: guild?.name, message: message.trim(), sentAt: Date.now(), ok: false, error: err.message });
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // Broadcast to all sentient channels
  let sent = 0;
  for (const [, guild] of discordClient.guilds.cache) {
    const sc = await getSentientChannel(guild.id).catch(() => null);
    if (!sc) continue;
    const ch = guild.channels.cache.get(sc.channelId);
    if (ch?.isTextBased()) {
      try {
        await (ch as TextChannel).send(payload);
        pushHistory({ id: Date.now().toString(), type: "server", target: `#${sc.channelName}`, guildName: guild.name, message: message.trim(), sentAt: Date.now(), ok: true });
        sent++;
      } catch { }
    }
  }
  res.json({ ok: true, sent });
});

// API: Send DM
app.post("/api/comms/dm", async (req, res) => {
  const { userId, message, secret } = req.body as { userId?: string; message?: string; secret?: string };
  if (!process.env["SESSION_SECRET"] || secret !== process.env["SESSION_SECRET"]) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  if (!userId || !message?.trim()) { res.status(400).json({ error: "userId and message required" }); return; }
  if (!discordClient?.isReady()) { res.status(503).json({ error: "Bot not connected" }); return; }
  try {
    const user = await discordClient.users.fetch(userId);
    await user.send(`**[OPERATOR-PRIME — COMMSLINK TRANSMISSION]**\n${message.trim()}`);
    pushHistory({ id: Date.now().toString(), type: "dm", target: `@${user.username}`, message: message.trim(), sentAt: Date.now(), ok: true });
    res.json({ ok: true, username: user.username });
  } catch (err: any) {
    pushHistory({ id: Date.now().toString(), type: "dm", target: `@${userId}`, message: message.trim(), sentAt: Date.now(), ok: false, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Dashboard HTML ───────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SIGMA-7 AURORA — Command Interface</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0c0c;
  --surface:#141414;
  --surface2:#1c1c1c;
  --border:#252525;
  --border2:#333;
  --text:#f0f0f0;
  --text2:#888;
  --text3:#555;
  --accent:#ffffff;
  --success:#5adf7a;
  --error:#f05555;
  --warning:#f0c055;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;font-size:14px;line-height:1.5;}
.mono{font-family:'JetBrains Mono',monospace;}

/* ── Layout ── */
.app{display:flex;flex-direction:column;min-height:100vh;}

/* ── Header ── */
.header{
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 24px;border-bottom:1px solid var(--border);
  background:var(--surface);gap:16px;flex-shrink:0;
}
.header-left{display:flex;align-items:center;gap:14px;}
.logo{width:48px;height:48px;border-radius:50%;object-fit:cover;border:1px solid var(--border2);}
.title-block{}
.title-block h1{font-size:18px;font-weight:700;letter-spacing:0.04em;color:#fff;}
.title-block h1 span{color:var(--text2);font-weight:400;}
.title-block p{font-size:11px;color:var(--text3);letter-spacing:0.06em;text-transform:uppercase;margin-top:2px;}
.header-right{text-align:right;}
.clock{font-family:'JetBrains Mono',monospace;font-size:15px;color:#fff;letter-spacing:0.1em;}
.clock-date{font-size:11px;color:var(--text3);letter-spacing:0.08em;margin-top:2px;}

/* ── Main panels grid ── */
.panels{
  display:grid;
  grid-template-columns:280px 1fr 380px;
  grid-template-rows:1fr;
  flex:1;
  min-height:0;
  gap:0;
}

/* ── Shared panel ── */
.panel{
  border-right:1px solid var(--border);
  display:flex;flex-direction:column;
  min-height:0;overflow:hidden;
}
.panel:last-child{border-right:none;}
.panel-header{
  padding:14px 16px;
  border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;
  flex-shrink:0;background:var(--surface);
}
.panel-title{
  font-size:10px;font-weight:600;letter-spacing:0.14em;
  text-transform:uppercase;color:var(--text2);
}
.panel-body{flex:1;overflow-y:auto;padding:16px;}
.panel-body::-webkit-scrollbar{width:4px;}
.panel-body::-webkit-scrollbar-track{background:transparent;}
.panel-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px;}

/* ── Lore Archive ── */
.lore-list{display:flex;flex-direction:column;gap:8px;}
.lore-item{
  background:var(--surface2);border:1px solid var(--border);
  padding:10px 12px;border-radius:4px;cursor:default;
}
.lore-item:hover{border-color:var(--border2);}
.lore-name{font-size:13px;color:#fff;font-weight:500;margin-bottom:3px;word-break:break-word;}
.lore-meta{font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace;}
.lore-empty{font-size:12px;color:var(--text3);text-align:center;padding:32px 0;}

/* ── Dashboard stats ── */
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;}
.stat-card{
  background:var(--surface2);border:1px solid var(--border);
  padding:14px;border-radius:4px;
}
.stat-label{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;}
.stat-value{font-size:15px;color:#fff;font-weight:600;font-family:'JetBrains Mono',monospace;}
.stat-value.online{color:var(--success);}
.stat-value.offline{color:var(--error);}
.pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--success);margin-right:6px;vertical-align:middle;animation:pulse 2s ease-in-out infinite;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}

.section-title{font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--text3);margin-bottom:10px;}
.guild-list{display:flex;flex-direction:column;gap:6px;}
.guild-row{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;}
.guild-dot{width:6px;height:6px;border-radius:50%;background:var(--success);flex-shrink:0;}
.guild-name{font-size:13px;color:#fff;}

/* ── Commslink ── */
.comms-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0;}
.ctab{
  flex:1;padding:10px;font-size:11px;font-weight:600;letter-spacing:0.1em;
  text-transform:uppercase;color:var(--text3);background:transparent;
  border:none;cursor:pointer;border-bottom:2px solid transparent;
  transition:color 0.15s,border-color 0.15s;
}
.ctab:hover{color:var(--text2);}
.ctab.active{color:#fff;border-bottom-color:#fff;}

.comms-section{display:flex;flex-direction:column;gap:10px;}
.comms-section.hidden{display:none;}

label.field-label{display:block;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);margin-bottom:5px;}
select,input,textarea{
  width:100%;background:var(--surface2);border:1px solid var(--border2);
  color:var(--text);font-family:'Inter',sans-serif;font-size:13px;
  padding:8px 10px;border-radius:4px;outline:none;
  transition:border-color 0.15s;
  appearance:none;
}
select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23555'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px;cursor:pointer;}
select:focus,input:focus,textarea:focus{border-color:#555;}
select option{background:#1c1c1c;}
textarea{resize:vertical;min-height:80px;font-size:13px;}
input[type=password]{letter-spacing:0.1em;}
::placeholder{color:var(--text3);}

.mention-bar{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;}
.mention-chip{
  font-size:11px;background:var(--surface2);border:1px solid var(--border2);
  color:var(--text2);padding:3px 8px;border-radius:3px;cursor:pointer;
  transition:background 0.1s,color 0.1s;white-space:nowrap;
}
.mention-chip:hover{background:var(--border2);color:#fff;}
.mention-chip.role{border-color:#3a3a3a;color:#aaa;}

.send-btn{
  width:100%;padding:10px;background:#fff;color:#000;
  font-weight:700;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;
  border:none;border-radius:4px;cursor:pointer;
  transition:background 0.15s,opacity 0.15s;
}
.send-btn:hover{background:#e0e0e0;}
.send-btn:disabled{opacity:0.3;cursor:not-allowed;}
.send-btn.sending{background:#444;color:#888;}

.tx-status{font-size:12px;font-family:'JetBrains Mono',monospace;min-height:18px;color:var(--text3);}
.tx-status.ok{color:var(--success);}
.tx-status.err{color:var(--error);}

/* ── Comms history ── */
.history-area{
  margin-top:16px;border-top:1px solid var(--border);padding-top:14px;
  display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;
}
.history-area::-webkit-scrollbar{width:3px;}
.history-area::-webkit-scrollbar-thumb{background:var(--border2);}
.hist-entry{
  background:var(--surface2);border:1px solid var(--border);
  border-radius:4px;padding:9px 11px;
}
.hist-entry.err-entry{border-color:#3a2020;}
.hist-meta{display:flex;align-items:center;gap:8px;margin-bottom:4px;}
.hist-type{font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:1px 6px;border-radius:2px;}
.hist-type.server{background:#202030;color:#8888cc;}
.hist-type.dm{background:#202820;color:#88bb88;}
.hist-target{font-size:11px;color:#fff;font-weight:500;}
.hist-time{font-size:10px;color:var(--text3);margin-left:auto;font-family:'JetBrains Mono',monospace;}
.hist-msg{font-size:12px;color:var(--text2);word-break:break-word;white-space:pre-wrap;}
.hist-ok{font-size:10px;color:var(--success);}
.hist-fail{font-size:10px;color:var(--error);}

/* ── Responsive ── */
@media(max-width:900px){
  .panels{grid-template-columns:1fr;grid-template-rows:auto;}
  .panel{border-right:none;border-bottom:1px solid var(--border);max-height:50vh;}
}
</style>
</head>
<body>
<div class="app">

<!-- Header -->
<header class="header">
  <div class="header-left">
    <img src="/static/logo.jpg" alt="Lambda-13" class="logo"/>
    <div class="title-block">
      <h1>SIGMA-7 <span>"AURORA"</span></h1>
      <p>MTF Lambda-13 "The Onlookers" — Command Interface</p>
    </div>
  </div>
  <div class="header-right">
    <div class="clock mono" id="clock">00:00:00</div>
    <div class="clock-date" id="clock-date"></div>
  </div>
</header>

<!-- Panels -->
<div class="panels">

  <!-- ── Lore Archive ── -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Lore Archive</span>
      <span class="panel-title mono" id="lore-count" style="color:var(--text3)">0 docs</span>
    </div>
    <div class="panel-body">
      <div class="lore-list" id="lore-list">
        <div class="lore-empty">Loading...</div>
      </div>
    </div>
  </div>

  <!-- ── Dashboard ── -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Dashboard</span>
    </div>
    <div class="panel-body">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Bot Status</div>
          <div class="stat-value" id="bot-status">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Discord Tag</div>
          <div class="stat-value mono" id="bot-tag" style="font-size:12px">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Guilds</div>
          <div class="stat-value" id="bot-guilds">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Uptime</div>
          <div class="stat-value mono" id="bot-uptime" style="font-size:12px">—</div>
        </div>
      </div>
      <div class="section-title">Connected Servers</div>
      <div class="guild-list" id="guild-list">
        <div style="color:var(--text3);font-size:12px;">Loading...</div>
      </div>
    </div>
  </div>

  <!-- ── Commslink ── -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Commslink</span>
    </div>
    <div class="comms-tabs">
      <button class="ctab active" onclick="switchCommsTab('server')" id="ctab-server">Server</button>
      <button class="ctab" onclick="switchCommsTab('dm')" id="ctab-dm">Direct Message</button>
    </div>
    <div class="panel-body" style="display:flex;flex-direction:column;gap:14px;">

      <!-- Access key (shared) -->
      <div>
        <label class="field-label">Access Key</label>
        <input type="password" id="comms-secret" placeholder="SESSION_SECRET value"/>
      </div>

      <!-- Server tab -->
      <div class="comms-section" id="section-server">
        <div>
          <label class="field-label">Guild</label>
          <select id="srv-guild" onchange="onGuildChange()">
            <option value="">Select a server...</option>
          </select>
        </div>
        <div>
          <label class="field-label">Channel</label>
          <select id="srv-channel">
            <option value="">Select a channel...</option>
          </select>
        </div>
        <div>
          <label class="field-label">Message</label>
          <textarea id="srv-msg" placeholder="Compose transmission... (Ctrl+Enter to send)"></textarea>
          <div class="mention-bar" id="srv-mentions"></div>
        </div>
        <button class="send-btn" id="srv-btn" onclick="sendServer()">Transmit to Channel</button>
        <div class="tx-status" id="srv-status"></div>
      </div>

      <!-- DM tab -->
      <div class="comms-section hidden" id="section-dm">
        <div>
          <label class="field-label">Guild (to browse members)</label>
          <select id="dm-guild" onchange="onDmGuildChange()">
            <option value="">Select a server...</option>
          </select>
        </div>
        <div>
          <label class="field-label">Member</label>
          <select id="dm-member">
            <option value="">Select a member...</option>
          </select>
        </div>
        <div style="display:flex;gap:6px;align-items:flex-end;">
          <div style="flex:1;">
            <label class="field-label">Or enter User ID directly</label>
            <input type="text" id="dm-userid" placeholder="Discord User ID"/>
          </div>
        </div>
        <div>
          <label class="field-label">Message</label>
          <textarea id="dm-msg" placeholder="Compose DM... (Ctrl+Enter to send)"></textarea>
        </div>
        <button class="send-btn" id="dm-btn" onclick="sendDM()">Send Direct Message</button>
        <div class="tx-status" id="dm-status"></div>
      </div>

      <!-- History -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;border-top:1px solid var(--border);padding-top:14px;">
          <span class="section-title" style="margin:0">Transmission Log</span>
          <button onclick="clearHistory()" style="font-size:10px;color:var(--text3);background:none;border:none;cursor:pointer;letter-spacing:0.05em;">CLEAR</button>
        </div>
        <div id="comms-history" style="display:flex;flex-direction:column;gap:8px;max-height:220px;overflow-y:auto;">
          <div style="color:var(--text3);font-size:12px;">No transmissions yet.</div>
        </div>
      </div>

    </div>
  </div>

</div>
</div>

<script>
// ── Globals ──
let guildsData = [];
let startedAt = null;
let secret = () => document.getElementById('comms-secret').value.trim();

// ── Clock ──
function tick() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toTimeString().slice(0,8);
  document.getElementById('clock-date').textContent = now.toDateString();
}
tick(); setInterval(tick, 1000);

// ── Uptime ──
function fmtUptime(ms) {
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60), d = Math.floor(h/24);
  if (d>0) return d+'d '+( h%24)+'h '+(m%60)+'m';
  if (h>0) return h+'h '+(m%60)+'m '+(s%60)+'s';
  if (m>0) return m+'m '+(s%60)+'s';
  return s+'s';
}

// ── Status poll ──
async function pollStatus() {
  try {
    const d = await fetch('/api/status').then(r=>r.json());
    if (!startedAt && d.startedAt) startedAt = d.startedAt;
    const el = document.getElementById('bot-status');
    if (d.online) {
      el.innerHTML = '<span class="pulse"></span>Online';
      el.className = 'stat-value online';
    } else {
      el.textContent = 'Offline';
      el.className = 'stat-value offline';
    }
    document.getElementById('bot-tag').textContent = d.tag || '—';
    document.getElementById('bot-guilds').textContent = d.guilds ?? '—';
  } catch {}
}
setInterval(()=>{ if(startedAt) document.getElementById('bot-uptime').textContent = fmtUptime(Date.now()-startedAt); },1000);
pollStatus(); setInterval(pollStatus, 10000);

// ── Guilds ──
async function loadGuilds() {
  try {
    const d = await fetch('/api/guilds').then(r=>r.json());
    guildsData = d.guilds || [];

    // Dashboard guild list
    const gl = document.getElementById('guild-list');
    if (!guildsData.length) { gl.innerHTML = '<div style="color:var(--text3);font-size:12px;">No guilds connected.</div>'; }
    else gl.innerHTML = guildsData.map(g=>\`<div class="guild-row"><span class="guild-dot"></span><span class="guild-name">\${esc(g.name)}</span></div>\`).join('');

    // Populate guild selects
    const opts = guildsData.map(g=>\`<option value="\${g.id}">\${esc(g.name)}</option>\`).join('');
    document.getElementById('srv-guild').innerHTML = '<option value="">Select a server...</option>' + opts;
    document.getElementById('dm-guild').innerHTML = '<option value="">Select a server...</option>' + opts;
  } catch {}
}
loadGuilds(); setInterval(loadGuilds, 30000);

function onGuildChange() {
  const gId = document.getElementById('srv-guild').value;
  const guild = guildsData.find(g=>g.id===gId);
  const sel = document.getElementById('srv-channel');
  if (!guild) { sel.innerHTML = '<option value="">Select a channel...</option>'; clearMentions(); return; }
  sel.innerHTML = '<option value="">Select a channel...</option>' +
    guild.channels.map(c=>\`<option value="\${c.id}">#\${esc(c.name)}</option>\`).join('');
  renderMentions(guild);
}

function renderMentions(guild) {
  const bar = document.getElementById('srv-mentions');
  const chips = [
    ...guild.roles.slice(0,8).map(r=>\`<span class="mention-chip role" onclick="insertMention('<@&\${r.id}>')" title="Mention @\${esc(r.name)}">@\${esc(r.name)}</span>\`)
  ];
  bar.innerHTML = chips.length ? '<span style="font-size:10px;color:var(--text3);align-self:center;margin-right:2px;">PING:</span>' + chips.join('') : '';
}
function clearMentions() { document.getElementById('srv-mentions').innerHTML = ''; }

function insertMention(mention) {
  const ta = document.getElementById('srv-msg');
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0,s) + mention + ' ' + ta.value.slice(e);
  ta.focus(); ta.selectionStart = ta.selectionEnd = s + mention.length + 1;
}

async function onDmGuildChange() {
  const gId = document.getElementById('dm-guild').value;
  const sel = document.getElementById('dm-member');
  sel.innerHTML = '<option value="">Loading members...</option>';
  if (!gId) { sel.innerHTML = '<option value="">Select a member...</option>'; return; }
  try {
    const d = await fetch('/api/guilds/'+gId+'/members').then(r=>r.json());
    sel.innerHTML = '<option value="">Select a member...</option>' +
      d.members.map(m=>\`<option value="\${m.id}">\${esc(m.displayName)} (@\${esc(m.username)})</option>\`).join('');
  } catch { sel.innerHTML = '<option value="">Failed to load</option>'; }
}

// ── Lore docs ──
async function loadLore() {
  try {
    const d = await fetch('/api/lore').then(r=>r.json());
    const docs = d.documents || [];
    document.getElementById('lore-count').textContent = docs.length + ' doc' + (docs.length!==1?'s':'');
    const list = document.getElementById('lore-list');
    if (!docs.length) { list.innerHTML = '<div class="lore-empty">No documents loaded.</div>'; return; }
    list.innerHTML = docs.map(doc=>\`
      <div class="lore-item">
        <div class="lore-name">\${esc(doc.name)}</div>
        <div class="lore-meta">fetched \${new Date(doc.lastFetched).toLocaleString()}</div>
      </div>\`).join('');
  } catch { document.getElementById('lore-list').innerHTML = '<div class="lore-empty">Failed to load.</div>'; }
}
loadLore(); setInterval(loadLore, 30000);

// ── Comms tabs ──
function switchCommsTab(tab) {
  ['server','dm'].forEach(t=>{
    document.getElementById('section-'+t).classList.toggle('hidden', t!==tab);
    document.getElementById('ctab-'+t).classList.toggle('active', t===tab);
  });
}

// ── Send server ──
async function sendServer() {
  const s = secret(), guildId = document.getElementById('srv-guild').value,
        channelId = document.getElementById('srv-channel').value,
        message = document.getElementById('srv-msg').value.trim(),
        statusEl = document.getElementById('srv-status'), btn = document.getElementById('srv-btn');
  if (!s) { setStatus(statusEl,'Access key required.','err'); return; }
  if (!guildId || !channelId) { setStatus(statusEl,'Select a guild and channel.','err'); return; }
  if (!message) { setStatus(statusEl,'Message cannot be empty.','err'); return; }
  btn.disabled=true; btn.classList.add('sending'); setStatus(statusEl,'Transmitting...','');
  try {
    const r = await fetch('/api/comms',{ method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message, secret:s, guildId, channelId }) });
    const d = await r.json();
    if (r.ok && d.ok) { setStatus(statusEl,'Transmitted.','ok'); document.getElementById('srv-msg').value=''; refreshHistory(); }
    else { setStatus(statusEl, d.error||'Failed.','err'); }
  } catch { setStatus(statusEl,'Network error.','err'); }
  finally { btn.disabled=false; btn.classList.remove('sending'); }
}

// ── Send DM ──
async function sendDM() {
  const s = secret(),
        userId = document.getElementById('dm-userid').value.trim() || document.getElementById('dm-member').value,
        message = document.getElementById('dm-msg').value.trim(),
        statusEl = document.getElementById('dm-status'), btn = document.getElementById('dm-btn');
  if (!s) { setStatus(statusEl,'Access key required.','err'); return; }
  if (!userId) { setStatus(statusEl,'Select a member or enter a User ID.','err'); return; }
  if (!message) { setStatus(statusEl,'Message cannot be empty.','err'); return; }
  btn.disabled=true; btn.classList.add('sending'); setStatus(statusEl,'Sending DM...','');
  try {
    const r = await fetch('/api/comms/dm',{ method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ userId, message, secret:s }) });
    const d = await r.json();
    if (r.ok && d.ok) { setStatus(statusEl,'DM sent to @'+d.username+'.','ok'); document.getElementById('dm-msg').value=''; document.getElementById('dm-userid').value=''; refreshHistory(); }
    else { setStatus(statusEl, d.error||'Failed.','err'); }
  } catch { setStatus(statusEl,'Network error.','err'); }
  finally { btn.disabled=false; btn.classList.remove('sending'); }
}

// ── History ──
async function refreshHistory() {
  const s = secret();
  if (!s) return;
  try {
    const d = await fetch('/api/comms/history',{ headers:{'x-session-secret':s} }).then(r=>r.json());
    const hist = d.history||[];
    const el = document.getElementById('comms-history');
    if (!hist.length) { el.innerHTML='<div style="color:var(--text3);font-size:12px;">No transmissions yet.</div>'; return; }
    el.innerHTML = hist.map(e=>\`
      <div class="hist-entry\${e.ok?'':' err-entry'}">
        <div class="hist-meta">
          <span class="hist-type \${e.type}">\${e.type==='dm'?'DM':'SVR'}</span>
          <span class="hist-target">\${esc(e.target)}\${e.guildName?' · '+esc(e.guildName):''}</span>
          <span class="hist-time">\${new Date(e.sentAt).toLocaleTimeString()}</span>
        </div>
        <div class="hist-msg">\${esc(e.message)}</div>
        \${e.ok?'<div class="hist-ok">✓ delivered</div>':'<div class="hist-fail">✗ '+esc(e.error||'failed')+'</div>'}
      </div>\`).join('');
  } catch {}
}

function clearHistory() {
  document.getElementById('comms-history').innerHTML = '<div style="color:var(--text3);font-size:12px;">No transmissions yet.</div>';
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', e=>{
  if (e.key==='Enter' && (e.ctrlKey||e.metaKey)) {
    const active = document.getElementById('section-server').classList.contains('hidden') ? 'dm' : 'server';
    if (active==='server') sendServer();
    else sendDM();
  }
});

// ── Escape util ──
function esc(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Auto-refresh history when key is entered ──
document.getElementById('comms-secret').addEventListener('blur', refreshHistory);
</script>
</body>
</html>`);
});

const HTTP_PORT = parseInt(process.env["PORT"] ?? "5000", 10);
app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`[SIGMA-7] Dashboard running on port ${HTTP_PORT}.`);
});

setInterval(() => { console.log("[SIGMA-7] Maintaining process priority..."); }, 280000);

// ─── Discord bot ──────────────────────────────────────────────────────────────
try {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    console.error("[SIGMA-7] DISCORD_BOT_TOKEN is not set — bot offline, dashboard still running.");
  } else {
    if (!process.env["OWNER_DISCORD_ID"]) console.warn("[SIGMA-7] WARNING: OWNER_DISCORD_ID is not set.");
    console.log("[SIGMA-7] Loading lore documents...");
    await seedInitialLore().catch((err) => console.error("[SIGMA-7] Lore seed failed:", err));
    startAutoRefresh();
    const client = createClient();
    registerEvents(client);
    const shutdown = () => { console.log("[SIGMA-7] Shutting down..."); cleanupPidFile(); client.destroy(); process.exit(0); };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    process.on("exit", cleanupPidFile);
    await client.login(token);
    discordClient = client;
    console.log("[SIGMA-7] Discord bot connected.");
  }
} catch (err) {
  console.error("[SIGMA-7] Bot startup failed — dashboard still running:", err);
}
