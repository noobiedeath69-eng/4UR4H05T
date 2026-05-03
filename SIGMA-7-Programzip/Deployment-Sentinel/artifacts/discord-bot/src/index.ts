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
  res.send("System Heartbeat: Online");
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
