import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { Client, GatewayIntentBits } from 'discord.js';

const app = express();
const httpServer = createServer(app);

// 1. DISCORD BOT INITIALIZATION
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] 
});

client.once('ready', () => {
    console.log(`✅ Discord Bot is online as ${client.user?.tag}`);
});

// 2. LOGGING UTILITY
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

// 3. MIDDLEWARE
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;
  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });
  next();
});

// 4. MAIN ASYNC BOOTSTRAP
(async () => {
  try {
    log("🤖 SIGMA-7 Bot Logic Injected into Server.");
    
    // We use dynamic imports to prevent "Top-level await" errors in CJS/ESM mixups
    await import("../SIGMA-7-Programzip/Deployment-Sentinel/artifacts/discord-bot/src/bot.js");
    await import("../SIGMA-7-Programzip/Deployment-Sentinel/artifacts/discord-bot/src/index.js");

    await client.login(process.env.DISCORD_TOKEN);
    await registerRoutes(httpServer, app);
  } catch (error) {
    console.error("❌ Critical Startup Error:", error);
  }

  // Error Handling
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || 500;
    res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log(`serving on port ${port}`);
  });
})();
