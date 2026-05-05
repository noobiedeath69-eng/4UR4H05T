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
app.use("/static", express.static(path.join(__dirname, "..", "public")));

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

// API: Guilds list with channels + roles
app.get("/api/guilds", (_req, res) => {
  if (!discordClient?.isReady()) { res.json({ guilds: [] }); return; }
  const guilds = discordClient.guilds.cache.map((guild) => ({
    id: guild.id,
    name: guild.name,
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
  const guild = discordClient.guilds.cache.get(req.params.guildId!);
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

// API: Send to server channel (or broadcast to all sentient channels)
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
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>SIGMA-7 AURORA — Command Interface</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0c0c;
  --surface:#141414;
  --surface2:#1e1e1e;
  --border:#242424;
  --border2:#333;
  --text:#f0f0f0;
  --text2:#909090;
  --text3:#505050;
  --success:#5adf7a;
  --error:#f05555;
}
html{height:100%;}
body{
  background:var(--bg);color:var(--text);
  font-family:'Inter',sans-serif;font-size:14px;line-height:1.5;
  min-height:100%;display:flex;flex-direction:column;
}
.mono{font-family:'JetBrains Mono',monospace;}

/* ── Header ── */
.header{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 20px;border-bottom:1px solid var(--border);
  background:var(--surface);gap:12px;flex-shrink:0;position:sticky;top:0;z-index:20;
}
.hdr-left{display:flex;align-items:center;gap:12px;min-width:0;}
.logo{width:44px;height:44px;border-radius:50%;object-fit:cover;border:1px solid var(--border2);flex-shrink:0;}
.title-block h1{font-size:16px;font-weight:700;letter-spacing:0.04em;color:#fff;white-space:nowrap;}
.title-block h1 span{color:var(--text3);font-weight:400;}
.title-block p{font-size:10px;color:var(--text3);letter-spacing:0.06em;text-transform:uppercase;margin-top:1px;}
.hdr-right{text-align:right;flex-shrink:0;}
.clock{font-family:'JetBrains Mono',monospace;font-size:14px;color:#fff;letter-spacing:0.1em;}
.clock-date{font-size:10px;color:var(--text3);letter-spacing:0.06em;margin-top:1px;}

/* ── Mobile tab bar ── */
.mobile-tabs{
  display:none;
  background:var(--surface);border-bottom:1px solid var(--border);
  position:sticky;top:69px;z-index:19;
}
.mobile-tab{
  flex:1;padding:10px 4px;font-size:11px;font-weight:600;letter-spacing:0.1em;
  text-transform:uppercase;color:var(--text3);background:transparent;
  border:none;border-bottom:2px solid transparent;cursor:pointer;
  transition:color .15s,border-color .15s;
}
.mobile-tab.active{color:#fff;border-bottom-color:#fff;}

/* ── Desktop 3-column layout ── */
.panels{
  display:grid;
  grid-template-columns:260px 1fr 360px;
  flex:1;min-height:0;
}

/* ── Panel ── */
.panel{
  border-right:1px solid var(--border);
  display:flex;flex-direction:column;
  overflow:hidden;
}
.panel:last-child{border-right:none;}
.panel-hdr{
  padding:12px 16px;border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;
  flex-shrink:0;background:var(--surface);
}
.panel-title{font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--text2);}
.panel-badge{font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace;}
.panel-body{flex:1;overflow-y:auto;padding:14px;}
.panel-body::-webkit-scrollbar{width:3px;}
.panel-body::-webkit-scrollbar-thumb{background:var(--border2);}

/* ── Lore ── */
.lore-item{
  background:var(--surface2);border:1px solid var(--border);
  padding:10px 12px;border-radius:4px;margin-bottom:8px;
}
.lore-item:hover{border-color:var(--border2);}
.lore-name{font-size:13px;color:#fff;font-weight:500;margin-bottom:3px;word-break:break-word;}
.lore-meta{font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace;}
.empty-msg{font-size:12px;color:var(--text3);text-align:center;padding:28px 0;}

/* ── Dashboard stats ── */
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;}
.stat-card{background:var(--surface2);border:1px solid var(--border);padding:12px;border-radius:4px;}
.stat-label{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px;}
.stat-val{font-size:14px;color:#fff;font-weight:600;font-family:'JetBrains Mono',monospace;}
.stat-val.online{color:var(--success);}
.stat-val.offline{color:var(--error);}
.pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--success);margin-right:5px;vertical-align:middle;animation:pulse 2s ease-in-out infinite;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.25;}}
.sec-title{font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;}
.guild-row{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;margin-bottom:6px;}
.guild-dot{width:6px;height:6px;border-radius:50%;background:var(--success);flex-shrink:0;}
.guild-name{font-size:13px;color:#fff;}

/* ── Commslink ── */
.comms-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface);}
.ctab{
  flex:1;padding:10px 8px;font-size:11px;font-weight:600;letter-spacing:.1em;
  text-transform:uppercase;color:var(--text3);background:transparent;
  border:none;border-bottom:2px solid transparent;cursor:pointer;transition:color .15s,border-color .15s;
}
.ctab:hover{color:var(--text2);}
.ctab.active{color:#fff;border-bottom-color:#fff;}

.field-section{display:flex;flex-direction:column;gap:10px;}
.field-section.hidden{display:none;}
.field-label{display:block;font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:5px;}

select,input,textarea{
  width:100%;background:var(--surface2);border:1px solid var(--border2);
  color:var(--text);font-family:'Inter',sans-serif;font-size:13px;
  padding:8px 10px;border-radius:4px;outline:none;transition:border-color .15s;
  -webkit-appearance:none;appearance:none;
}
select{
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23555'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 10px center;padding-right:28px;cursor:pointer;
}
select option{background:#1e1e1e;}
select:focus,input:focus,textarea:focus{border-color:#555;}
textarea{resize:vertical;min-height:80px;line-height:1.5;}
input[type=password]{letter-spacing:.08em;}
::placeholder{color:var(--text3);}

.mention-bar{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;min-height:0;}
.mention-chip{
  font-size:11px;background:var(--surface2);border:1px solid var(--border2);
  color:var(--text2);padding:3px 8px;border-radius:3px;cursor:pointer;
  transition:background .1s,color .1s;white-space:nowrap;
  font-family:'JetBrains Mono',monospace;
}
.mention-chip:hover{background:var(--border2);color:#fff;}

.send-btn{
  width:100%;padding:10px;background:#fff;color:#000;
  font-weight:700;font-size:12px;letter-spacing:.12em;text-transform:uppercase;
  border:none;border-radius:4px;cursor:pointer;transition:background .15s,opacity .15s;
}
.send-btn:hover{background:#e8e8e8;}
.send-btn:disabled{opacity:.3;cursor:not-allowed;}
.send-btn.sending{background:#333;color:#666;}

.tx-status{
  font-size:12px;font-family:'JetBrains Mono',monospace;
  min-height:18px;color:var(--text3);padding:2px 0;
}
.tx-status.ok{color:var(--success);}
.tx-status.err{color:var(--error);}

/* Broadcast toggle */
.broadcast-row{display:flex;align-items:center;gap:8px;}
.broadcast-row input[type=checkbox]{width:auto;cursor:pointer;accent-color:#fff;}
.broadcast-row label{font-size:12px;color:var(--text2);cursor:pointer;}

/* ── History ── */
.history-wrap{margin-top:14px;border-top:1px solid var(--border);padding-top:12px;}
.history-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.history-scroll{display:flex;flex-direction:column;gap:7px;max-height:220px;overflow-y:auto;}
.history-scroll::-webkit-scrollbar{width:3px;}
.history-scroll::-webkit-scrollbar-thumb{background:var(--border2);}
.hist-entry{background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:8px 10px;}
.hist-entry.fail{border-color:#3a1f1f;}
.hist-meta{display:flex;align-items:center;gap:7px;margin-bottom:3px;flex-wrap:wrap;}
.hist-badge{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:1px 6px;border-radius:2px;}
.hist-badge.server{background:#1e1e30;color:#8888cc;}
.hist-badge.dm{background:#1e2a1e;color:#77bb77;}
.hist-target{font-size:12px;color:#fff;font-weight:500;}
.hist-guild{font-size:11px;color:var(--text3);}
.hist-time{font-size:10px;color:var(--text3);margin-left:auto;font-family:'JetBrains Mono',monospace;white-space:nowrap;}
.hist-msg{font-size:12px;color:var(--text2);word-break:break-word;white-space:pre-wrap;max-height:60px;overflow:hidden;}
.hist-result{font-size:10px;margin-top:3px;}
.hist-result.ok{color:var(--success);}
.hist-result.fail{color:var(--error);}

/* ── Mobile ── */
@media(max-width:768px){
  .mobile-tabs{display:flex;}
  .panels{
    display:flex;flex-direction:column;
    flex:1;
  }
  .panel{
    border-right:none;
    display:none;
    flex:1;
    min-height:0;
    overflow-y:auto;
  }
  .panel.mobile-active{display:flex;}
  .panel-body{overflow-y:visible;}
  .hdr-right{display:none;}
  .title-block p{display:none;}
  .stat-grid{grid-template-columns:1fr 1fr;}
  .history-scroll{max-height:none;}
}
@media(max-width:480px){
  .header{padding:10px 14px;}
  .logo{width:36px;height:36px;}
  .title-block h1{font-size:14px;}
}
</style>
</head>
<body>

<!-- Header -->
<header class="header">
  <div class="hdr-left">
    <img src="/static/logo.jpg" alt="Λ-13" class="logo"/>
    <div class="title-block">
      <h1>SIGMA-7 <span>"AURORA"</span></h1>
      <p>MTF Lambda-13 — Command Interface</p>
    </div>
  </div>
  <div class="hdr-right">
    <div class="clock mono" id="clock">00:00:00</div>
    <div class="clock-date" id="clock-date"></div>
  </div>
</header>

<!-- Mobile tab bar (hidden on desktop) -->
<nav class="mobile-tabs">
  <button class="mobile-tab active" onclick="switchMobile('lore')" id="mtab-lore">Lore</button>
  <button class="mobile-tab" onclick="switchMobile('dash')" id="mtab-dash">Dashboard</button>
  <button class="mobile-tab" onclick="switchMobile('comms')" id="mtab-comms">Commslink</button>
</nav>

<!-- 3 Panels -->
<div class="panels">

  <!-- ── LORE ARCHIVE ── -->
  <div class="panel mobile-active" id="panel-lore">
    <div class="panel-hdr">
      <span class="panel-title">Lore Archive</span>
      <span class="panel-badge" id="lore-count">—</span>
    </div>
    <div class="panel-body">
      <div id="lore-list"><div class="empty-msg">Loading...</div></div>
    </div>
  </div>

  <!-- ── DASHBOARD ── -->
  <div class="panel" id="panel-dash">
    <div class="panel-hdr"><span class="panel-title">Dashboard</span></div>
    <div class="panel-body">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div class="stat-val" id="bot-status">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Bot Tag</div>
          <div class="stat-val mono" id="bot-tag" style="font-size:11px;word-break:break-all">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Guilds</div>
          <div class="stat-val" id="bot-guilds">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Uptime</div>
          <div class="stat-val mono" id="bot-uptime" style="font-size:11px">—</div>
        </div>
      </div>
      <div class="sec-title">Connected Servers</div>
      <div id="guild-list"><div style="color:var(--text3);font-size:12px;">Loading...</div></div>
    </div>
  </div>

  <!-- ── COMMSLINK ── -->
  <div class="panel" id="panel-comms">
    <div class="panel-hdr"><span class="panel-title">Commslink</span></div>

    <!-- Sub-tabs: Server / DM -->
    <div class="comms-tabs">
      <button class="ctab active" onclick="switchCommsTab('server')" id="ctab-server">Server</button>
      <button class="ctab" onclick="switchCommsTab('dm')" id="ctab-dm">Direct Message</button>
    </div>

    <div class="panel-body" style="display:flex;flex-direction:column;gap:12px;">

      <!-- Shared: access key -->
      <div>
        <label class="field-label">Access Key</label>
        <input type="password" id="comms-secret" placeholder="SESSION_SECRET" autocomplete="current-password" data-testid="input-secret"/>
      </div>

      <!-- SERVER tab -->
      <div class="field-section" id="section-server">
        <!-- Broadcast toggle -->
        <div class="broadcast-row">
          <input type="checkbox" id="srv-broadcast" onchange="toggleBroadcast()"/>
          <label for="srv-broadcast">Broadcast to all sentient channels</label>
        </div>

        <div id="srv-target-fields">
          <div style="margin-bottom:10px;">
            <label class="field-label">Guild</label>
            <select id="srv-guild" onchange="onGuildChange()" data-testid="select-guild">
              <option value="">Select a server...</option>
            </select>
          </div>
          <div>
            <label class="field-label">Channel</label>
            <select id="srv-channel" data-testid="select-channel">
              <option value="">Select a channel...</option>
            </select>
          </div>
        </div>

        <div>
          <label class="field-label">Message</label>
          <textarea id="srv-msg" placeholder="Compose transmission... (Ctrl+Enter to send)" data-testid="textarea-server-msg"></textarea>
          <div class="mention-bar" id="srv-mentions"></div>
        </div>

        <button class="send-btn" id="srv-btn" onclick="sendServer()" data-testid="button-transmit">Transmit to Channel</button>
        <div class="tx-status" id="srv-status"></div>
      </div>

      <!-- DM tab -->
      <div class="field-section hidden" id="section-dm">
        <div>
          <label class="field-label">Guild (browse members)</label>
          <select id="dm-guild" onchange="onDmGuildChange()" data-testid="select-dm-guild">
            <option value="">Select a server...</option>
          </select>
        </div>
        <div>
          <label class="field-label">Member</label>
          <select id="dm-member" data-testid="select-dm-member">
            <option value="">Select a member...</option>
          </select>
        </div>
        <div>
          <label class="field-label">Or enter User ID directly</label>
          <input type="text" id="dm-userid" placeholder="850667502673199125" data-testid="input-user-id"/>
        </div>
        <div>
          <label class="field-label">Message</label>
          <textarea id="dm-msg" placeholder="Compose DM... (Ctrl+Enter to send)" data-testid="textarea-dm-msg"></textarea>
        </div>
        <button class="send-btn" id="dm-btn" onclick="sendDM()" data-testid="button-send-dm">Send Direct Message</button>
        <div class="tx-status" id="dm-status"></div>
      </div>

      <!-- Transmission log -->
      <div class="history-wrap">
        <div class="history-header">
          <span class="sec-title" style="margin:0">Transmission Log</span>
          <button onclick="clearHistory()" style="font-size:10px;color:var(--text3);background:none;border:none;cursor:pointer;letter-spacing:.05em;padding:2px 4px;">CLEAR</button>
        </div>
        <div class="history-scroll" id="comms-history">
          <div style="color:var(--text3);font-size:12px;">No transmissions yet.</div>
        </div>
      </div>

    </div>
  </div>

</div><!-- .panels -->

<script>
// ── State ──
let guildsData = [];
let startedAt = null;
const secret = () => document.getElementById('comms-secret').value.trim();

// ── Clock ──
function tick() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toTimeString().slice(0,8);
  document.getElementById('clock-date').textContent = now.toDateString();
}
tick(); setInterval(tick, 1000);

// ── Uptime ──
function fmtUptime(ms) {
  const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60),d=Math.floor(h/24);
  if(d>0) return d+'d '+(h%24)+'h '+(m%60)+'m';
  if(h>0) return h+'h '+(m%60)+'m '+(s%60)+'s';
  if(m>0) return m+'m '+(s%60)+'s';
  return s+'s';
}

// ── Mobile tabs ──
function switchMobile(tab) {
  ['lore','dash','comms'].forEach(t => {
    document.getElementById('panel-'+t).classList.toggle('mobile-active', t===tab);
    document.getElementById('mtab-'+t).classList.toggle('active', t===tab);
  });
}

// ── Status poll ──
async function pollStatus() {
  try {
    const d = await fetch('/api/status').then(r=>r.json());
    if (!startedAt && d.startedAt) startedAt = d.startedAt;
    const el = document.getElementById('bot-status');
    if (d.online) { el.innerHTML='<span class="pulse"></span>Online'; el.className='stat-val online'; }
    else { el.textContent='Offline'; el.className='stat-val offline'; }
    document.getElementById('bot-tag').textContent = d.tag || '—';
    document.getElementById('bot-guilds').textContent = d.guilds ?? '—';
  } catch {}
}
setInterval(()=>{ if(startedAt) document.getElementById('bot-uptime').textContent=fmtUptime(Date.now()-startedAt); }, 1000);
pollStatus(); setInterval(pollStatus, 10000);

// ── Guilds ──
async function loadGuilds() {
  try {
    const d = await fetch('/api/guilds').then(r=>r.json());
    guildsData = d.guilds || [];
    const gl = document.getElementById('guild-list');
    gl.innerHTML = guildsData.length
      ? guildsData.map(g=>\`<div class="guild-row"><span class="guild-dot"></span><span class="guild-name">\${esc(g.name)}</span></div>\`).join('')
      : '<div style="color:var(--text3);font-size:12px;">No guilds.</div>';
    const opts = guildsData.map(g=>\`<option value="\${g.id}">\${esc(g.name)}</option>\`).join('');
    document.getElementById('srv-guild').innerHTML = '<option value="">Select a server...</option>'+opts;
    document.getElementById('dm-guild').innerHTML = '<option value="">Select a server...</option>'+opts;
  } catch {}
}
loadGuilds(); setInterval(loadGuilds, 30000);

// ── Lore ──
async function loadLore() {
  try {
    const d = await fetch('/api/lore').then(r=>r.json());
    const docs = d.documents || [];
    document.getElementById('lore-count').textContent = docs.length+' doc'+(docs.length!==1?'s':'');
    document.getElementById('lore-list').innerHTML = docs.length
      ? docs.map(doc=>\`<div class="lore-item"><div class="lore-name">\${esc(doc.name)}</div><div class="lore-meta">fetched \${new Date(doc.lastFetched).toLocaleString()}</div></div>\`).join('')
      : '<div class="empty-msg">No documents loaded.</div>';
  } catch { document.getElementById('lore-list').innerHTML='<div class="empty-msg">Failed to load.</div>'; }
}
loadLore(); setInterval(loadLore, 30000);

// ── Comms sub-tabs ──
function switchCommsTab(tab) {
  ['server','dm'].forEach(t=>{
    document.getElementById('section-'+t).classList.toggle('hidden', t!==tab);
    document.getElementById('ctab-'+t).classList.toggle('active', t===tab);
  });
}

// ── Broadcast toggle ──
function toggleBroadcast() {
  const bc = document.getElementById('srv-broadcast').checked;
  document.getElementById('srv-target-fields').style.display = bc ? 'none' : 'block';
  document.getElementById('srv-btn').textContent = bc ? 'Broadcast to All Sentient Channels' : 'Transmit to Channel';
}

// ── Server guild → channels + role chips ──
function onGuildChange() {
  const gId = document.getElementById('srv-guild').value;
  const guild = guildsData.find(g=>g.id===gId);
  const sel = document.getElementById('srv-channel');
  sel.innerHTML = guild
    ? '<option value="">Select a channel...</option>'+guild.channels.map(c=>\`<option value="\${c.id}">#\${esc(c.name)}</option>\`).join('')
    : '<option value="">Select a channel...</option>';
  renderRoleChips(guild);
}

function renderRoleChips(guild) {
  const bar = document.getElementById('srv-mentions');
  if (!guild || !guild.roles.length) { bar.innerHTML=''; return; }
  bar.innerHTML =
    '<span style="font-size:10px;color:var(--text3);align-self:center;flex-shrink:0;">PING:</span>' +
    guild.roles.slice(0,10).map(r=>\`<span class="mention-chip" onclick="insertAt('<@&\${r.id}>', \\'srv-msg\\')" title="Insert @\${esc(r.name)}">@\${esc(r.name)}</span>\`).join('');
}

function insertAt(text, fieldId) {
  const ta = document.getElementById(fieldId);
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0,s)+text+' '+ta.value.slice(e);
  ta.focus(); ta.selectionStart = ta.selectionEnd = s+text.length+1;
}

// ── DM guild → members ──
async function onDmGuildChange() {
  const gId = document.getElementById('dm-guild').value;
  const sel = document.getElementById('dm-member');
  if (!gId) { sel.innerHTML='<option value="">Select a member...</option>'; return; }
  sel.innerHTML='<option value="">Loading members...</option>';
  try {
    const d = await fetch('/api/guilds/'+gId+'/members').then(r=>r.json());
    sel.innerHTML = '<option value="">Select a member...</option>' +
      d.members.map(m=>\`<option value="\${m.id}">\${esc(m.displayName)} (@\${esc(m.username)})</option>\`).join('');
  } catch { sel.innerHTML='<option value="">Failed to load</option>'; }
}

// ── Status helper ──
function setStatus(el, msg, cls) {
  el.textContent = msg;
  el.className = 'tx-status'+(cls?' '+cls:'');
}

// ── Send server ──
async function sendServer() {
  const s = secret();
  const broadcast = document.getElementById('srv-broadcast').checked;
  const guildId = broadcast ? '' : document.getElementById('srv-guild').value;
  const channelId = broadcast ? '' : document.getElementById('srv-channel').value;
  const message = document.getElementById('srv-msg').value.trim();
  const statusEl = document.getElementById('srv-status'), btn = document.getElementById('srv-btn');
  if (!s) { setStatus(statusEl,'Access key required.','err'); return; }
  if (!broadcast && (!guildId || !channelId)) { setStatus(statusEl,'Select a guild and channel.','err'); return; }
  if (!message) { setStatus(statusEl,'Message cannot be empty.','err'); return; }
  btn.disabled=true; btn.classList.add('sending'); setStatus(statusEl,'Transmitting...');
  try {
    const r = await fetch('/api/comms',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message,secret:s,guildId,channelId})});
    const d = await r.json();
    if (r.ok && d.ok) {
      setStatus(statusEl, broadcast ? \`Broadcast to \${d.sent} channel(s).\` : 'Transmitted.', 'ok');
      document.getElementById('srv-msg').value='';
      refreshHistory();
    } else { setStatus(statusEl, d.error||'Failed.','err'); }
  } catch { setStatus(statusEl,'Network error.','err'); }
  finally { btn.disabled=false; btn.classList.remove('sending'); }
}

// ── Send DM ──
async function sendDM() {
  const s = secret();
  const userId = document.getElementById('dm-userid').value.trim() || document.getElementById('dm-member').value;
  const message = document.getElementById('dm-msg').value.trim();
  const statusEl = document.getElementById('dm-status'), btn = document.getElementById('dm-btn');
  if (!s) { setStatus(statusEl,'Access key required.','err'); return; }
  if (!userId) { setStatus(statusEl,'Select a member or enter a User ID.','err'); return; }
  if (!message) { setStatus(statusEl,'Message cannot be empty.','err'); return; }
  btn.disabled=true; btn.classList.add('sending'); setStatus(statusEl,'Sending DM...');
  try {
    const r = await fetch('/api/comms/dm',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({userId,message,secret:s})});
    const d = await r.json();
    if (r.ok && d.ok) {
      setStatus(statusEl,'DM sent to @'+d.username+'.','ok');
      document.getElementById('dm-msg').value='';
      document.getElementById('dm-userid').value='';
      refreshHistory();
    } else { setStatus(statusEl, d.error||'Failed.','err'); }
  } catch { setStatus(statusEl,'Network error.','err'); }
  finally { btn.disabled=false; btn.classList.remove('sending'); }
}

// ── History ──
async function refreshHistory() {
  const s = secret();
  if (!s) return;
  try {
    const d = await fetch('/api/comms/history',{headers:{'x-session-secret':s}}).then(r=>r.json());
    renderHistory(d.history||[]);
  } catch {}
}

function renderHistory(hist) {
  const el = document.getElementById('comms-history');
  if (!hist.length) { el.innerHTML='<div style="color:var(--text3);font-size:12px;">No transmissions yet.</div>'; return; }
  el.innerHTML = hist.map(e=>\`
    <div class="hist-entry\${e.ok?'':' fail'}">
      <div class="hist-meta">
        <span class="hist-badge \${e.type}">\${e.type==='dm'?'DM':'SVR'}</span>
        <span class="hist-target">\${esc(e.target)}</span>
        \${e.guildName?'<span class="hist-guild">· '+esc(e.guildName)+'</span>':''}
        <span class="hist-time">\${new Date(e.sentAt).toLocaleTimeString()}</span>
      </div>
      <div class="hist-msg">\${esc(e.message)}</div>
      <div class="hist-result \${e.ok?'ok':'fail'}">\${e.ok?'✓ delivered':'✗ '+(esc(e.error||'failed'))}</div>
    </div>\`).join('');
}

function clearHistory() {
  renderHistory([]);
}

// ── Auto-refresh history on key entry ──
document.getElementById('comms-secret').addEventListener('change', refreshHistory);

// ── Keyboard shortcut: Ctrl+Enter ──
document.addEventListener('keydown', e => {
  if (!(e.key==='Enter' && (e.ctrlKey||e.metaKey))) return;
  const serverHidden = document.getElementById('section-server').classList.contains('hidden');
  if (serverHidden) sendDM(); else sendServer();
});

// ── Escape util ──
function esc(s) { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
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
