# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Discord bot**: discord.js v14, OpenAI (Replit AI Integrations)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── discord-bot/        # MTF Lambda-13 Discord Bot (SIGMA-7)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package
```

## Discord Bot — MTF Lambda-13 "The Onlookers"

Located at `artifacts/discord-bot/`. Prefix-command bot powered by discord.js v14.

### Commands

| Command | Description | Access |
|---|---|---|
| `!deploymentstart [Location]` | Opens a 20-min poll, then starts DEPLOYMENT or PATROL | Whitelisted / Admin |
| `!deploymentend` | Ends active deployment/patrol and posts mission report | Whitelisted / Admin |
| `!projectset` | Sets the SIGMA-7 sentient channel via select menu | Owner only |
| `!userpermit @User` | Whitelists a user for deployment commands | Owner only |
| `!loreupdate` | Lists all loaded lore dossiers | Owner only |
| `!loreupdate <url> [name]` | Adds or replaces a Google Docs lore dossier | Owner only |
| `!loreupdate refresh` | Re-fetches all stored lore documents | Owner only |
| `!loreremove` | Lists all loaded lore dossiers with numbers | Owner only |
| `!loreremove <number>` | Permanently removes a lore dossier by number | Owner only |

### Sentient Channel (SIGMA-7)
- Any non-command message in the sentient channel is answered by SIGMA-7 (OpenAI gpt-5.2)
- SCP Foundation MTF/Overseer persona
- Conversation history maintained per channel (last 20 messages in memory)

### Database Tables
- `discord_deployments` — tracks polls and active deployments
- `discord_whitelisted_users` — users permitted to use deployment commands
- `discord_sentient_channels` — the channel assigned to SIGMA-7

### Required Secrets
- `DISCORD_BOT_TOKEN` — Bot token from Discord Developer Portal
- `OWNER_DISCORD_ID` — Your Discord user ID (enable Developer Mode → right-click your name → Copy User ID)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — Provided by Replit AI Integrations (no personal key required)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — Provided by Replit AI Integrations (no personal key required)

### Required Bot Permissions (see below)
- View Channels, Send Messages, Add Reactions, Read Message History
- Manage Messages, Create Public Threads, Send Messages in Threads, Embed Links
- Privileged Intents: **Message Content Intent**, **Server Members Intent**

### Workflow
- Name: `Discord Bot`
- Command: `pnpm --filter @workspace/discord-bot run dev`

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

## Packages

### `artifacts/api-server` (`@workspace/api-server`)
Express 5 API server. Routes in `src/routes/`.

### `artifacts/discord-bot` (`@workspace/discord-bot`)
Discord bot using prefix commands (`!`).

### `lib/db` (`@workspace/db`)
Database layer using Drizzle ORM with PostgreSQL.

### `lib/api-spec` (`@workspace/api-spec`)
OpenAPI 3.1 spec + Orval codegen config.

### `lib/api-zod` (`@workspace/api-zod`)
Generated Zod schemas from OpenAPI spec.

### `lib/api-client-react` (`@workspace/api-client-react`)
Generated React Query hooks from OpenAPI spec.
