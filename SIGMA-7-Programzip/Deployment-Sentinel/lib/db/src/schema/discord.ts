import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const deploymentsTable = pgTable("discord_deployments", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  location: text("location").notNull(),
  type: text("type").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  channelId: text("channel_id").notNull(),
  pollMessageId: text("poll_message_id").notNull(),
  pollStartedAt: timestamp("poll_started_at", { withTimezone: true }).defaultNow().notNull(),
  timerMessageId: text("timer_message_id"),
  threadId: text("thread_id"),
  startedByUserId: text("started_by_user_id").notNull(),
  startedByUsername: text("started_by_username").notNull(),
  active: boolean("active").default(true).notNull(),
  phase: text("phase").default("poll").notNull(),
});

export const whitelistedUsersTable = pgTable("discord_whitelisted_users", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  username: text("username").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sentientChannelsTable = pgTable("discord_sentient_channels", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull().unique(),
  channelName: text("channel_name").notNull(),
  guildId: text("guild_id").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
});

export const loreDocumentsTable = pgTable("discord_lore_documents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  content: text("content").notNull(),
  lastFetched: timestamp("last_fetched", { withTimezone: true }).defaultNow().notNull(),
});

export type Deployment = typeof deploymentsTable.$inferSelect;
export type NewDeployment = typeof deploymentsTable.$inferInsert;
export type WhitelistedUser = typeof whitelistedUsersTable.$inferSelect;
export type SentientChannel = typeof sentientChannelsTable.$inferSelect;
export type LoreDocument = typeof loreDocumentsTable.$inferSelect;
