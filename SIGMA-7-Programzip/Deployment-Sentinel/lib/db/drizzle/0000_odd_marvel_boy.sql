CREATE TABLE "discord_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"location" text NOT NULL,
	"type" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"channel_id" text NOT NULL,
	"poll_message_id" text NOT NULL,
	"poll_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timer_message_id" text,
	"thread_id" text,
	"started_by_user_id" text NOT NULL,
	"started_by_username" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phase" text DEFAULT 'poll' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_lore_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"content" text NOT NULL,
	"last_fetched" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_lore_documents_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "discord_sentient_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"guild_id" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_sentient_channels_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
CREATE TABLE "discord_whitelisted_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_whitelisted_users_user_id_unique" UNIQUE("user_id")
);
