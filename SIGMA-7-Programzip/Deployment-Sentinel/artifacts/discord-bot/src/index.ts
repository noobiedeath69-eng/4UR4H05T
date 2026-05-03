import fs from "fs";
import express from "express";
import { createClient, registerEvents } from "./bot.js";
import { seedInitialLore, startAutoRefresh } from "./lib/lore.js";

const PID_FILE = "/tmp/sigma7-bot.pid";

function killPreviousInstance(): void {
  if (!fs.existsSync(PID_FILE)) return;

  const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
  const oldPid = parseInt(raw, 10);
  if (!oldPid || oldPid === process.pid) return;

  try {
    process.kill(oldPid, "SIGKILL");
    console.log(`[SIGMA-7] Killed previous instance (PID ${oldPid}).`);
  } catch {
    // Already dead — that's fine
  }
}

function writePidFile(): void {
  fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
}

function cleanupPidFile(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // Already gone
  }
}

killPreviousInstance();
writePidFile();

// Keep-alive HTTP server
const app = express();
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SIGMA-7 "AURORA" — System Status</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #050a0e;
      color: #c8e6f0;
      font-family: 'Share Tech Mono', monospace;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      overflow: hidden;
    }

    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background:
        repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,180,255,0.015) 2px, rgba(0,180,255,0.015) 4px);
      pointer-events: none;
      z-index: 0;
    }

    .container {
      position: relative;
      z-index: 1;
      max-width: 640px;
      width: 100%;
      border: 1px solid rgba(0,180,255,0.25);
      padding: 2.5rem 2rem;
      background: rgba(0,20,35,0.85);
      box-shadow: 0 0 40px rgba(0,140,220,0.1), inset 0 0 60px rgba(0,0,0,0.4);
    }

    .corner {
      position: absolute;
      width: 12px; height: 12px;
      border-color: #00b4ff;
      border-style: solid;
    }
    .corner.tl { top: -1px; left: -1px; border-width: 2px 0 0 2px; }
    .corner.tr { top: -1px; right: -1px; border-width: 2px 2px 0 0; }
    .corner.bl { bottom: -1px; left: -1px; border-width: 0 0 2px 2px; }
    .corner.br { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; }

    .header-label {
      font-size: 0.65rem;
      letter-spacing: 0.25em;
      color: #3a7a99;
      text-transform: uppercase;
      margin-bottom: 0.4rem;
    }

    h1 {
      font-family: 'Rajdhani', sans-serif;
      font-weight: 700;
      font-size: 2rem;
      color: #00cfff;
      letter-spacing: 0.08em;
      text-shadow: 0 0 20px rgba(0,200,255,0.4);
      line-height: 1.1;
    }

    h1 span {
      color: #4a9abb;
      font-weight: 400;
    }

    .divider {
      border: none;
      border-top: 1px solid rgba(0,180,255,0.15);
      margin: 1.5rem 0;
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .pulse {
      width: 10px; height: 10px;
      border-radius: 50%;
      background: #00ff88;
      box-shadow: 0 0 8px #00ff88, 0 0 16px rgba(0,255,136,0.4);
      animation: pulse 2s ease-in-out infinite;
      flex-shrink: 0;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 8px #00ff88, 0 0 16px rgba(0,255,136,0.4); }
      50% { opacity: 0.5; box-shadow: 0 0 4px #00ff88; }
    }

    .status-text {
      font-size: 0.85rem;
      color: #00ff88;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      margin-top: 1.25rem;
    }

    .info-block {
      border: 1px solid rgba(0,180,255,0.1);
      padding: 0.75rem 1rem;
      background: rgba(0,180,255,0.03);
    }

    .info-block .label {
      font-size: 0.6rem;
      letter-spacing: 0.2em;
      color: #3a7a99;
      text-transform: uppercase;
      margin-bottom: 0.3rem;
    }

    .info-block .value {
      font-size: 0.85rem;
      color: #a0d8ef;
    }

    .footer {
      margin-top: 2rem;
      font-size: 0.6rem;
      color: #1e4a60;
      letter-spacing: 0.15em;
      text-align: center;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="corner tl"></div>
    <div class="corner tr"></div>
    <div class="corner bl"></div>
    <div class="corner br"></div>

    <div class="header-label">Foundation Intelligence Platform — Restricted Access</div>
    <h1>SIGMA-7 <span>"AURORA"</span></h1>

    <hr class="divider" />

    <div class="status-row">
      <div class="pulse"></div>
      <div class="status-text">System Heartbeat: Online</div>
    </div>

    <div class="info-grid">
      <div class="info-block">
        <div class="label">Assigned Unit</div>
        <div class="value">MTF Lambda-13</div>
      </div>
      <div class="info-block">
        <div class="label">Designation</div>
        <div class="value">The Onlookers</div>
      </div>
      <div class="info-block">
        <div class="label">Clearance Level</div>
        <div class="value">Level 4 / O5-Auth</div>
      </div>
      <div class="info-block">
        <div class="label">System Uptime</div>
        <div class="value" id="uptime">Calculating...</div>
      </div>
    </div>

    <div class="footer">SCP Foundation — Secure. Contain. Protect. &nbsp;|&nbsp; Unauthorized access is a D-class offense.</div>
  </div>

  <script>
    const start = Date.now();
    function fmt(ms) {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      const d = Math.floor(h / 24);
      if (d > 0) return d + 'd ' + (h % 24) + 'h ' + (m % 60) + 'm';
      if (h > 0) return h + 'h ' + (m % 60) + 'm ' + (s % 60) + 's';
      if (m > 0) return m + 'm ' + (s % 60) + 's';
      return s + 's';
    }
    setInterval(() => {
      document.getElementById('uptime').textContent = fmt(Date.now() - start);
    }, 1000);
  </script>
</body>
</html>`);
});
app.listen(5000, () => {
  console.log("[SIGMA-7] Keep-alive server running on port 5000.");
});
setInterval(() => {
  console.log("[SIGMA-7] Maintaining process priority...");
}, 280000);

const token = process.env["DISCORD_BOT_TOKEN"];
if (!token) {
  throw new Error("DISCORD_BOT_TOKEN is not set. Please add it to your secrets.");
}

if (!process.env["OWNER_DISCORD_ID"]) {
  console.warn("[SIGMA-7] WARNING: OWNER_DISCORD_ID is not set. Owner-only commands will be disabled.");
}

console.log("[SIGMA-7] Loading lore documents...");
await seedInitialLore().catch((err) =>
  console.error("[SIGMA-7] Lore seed failed (continuing without lore):", err)
);
startAutoRefresh();

const client = createClient();
registerEvents(client);

const shutdown = () => {
  console.log("[SIGMA-7] Shutting down — disconnecting from Discord gateway...");
  cleanupPidFile();
  client.destroy();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("exit", cleanupPidFile);

await client.login(token);
