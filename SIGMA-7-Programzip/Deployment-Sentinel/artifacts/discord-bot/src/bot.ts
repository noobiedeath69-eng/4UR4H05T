import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  Message,
  ButtonInteraction,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  TextChannel,
  GuildMember,
} from "discord.js";
import { handleDeploymentStart } from "./commands/deploymentStart.js";
import { handleDeploymentEnd } from "./commands/deploymentEnd.js";
import { handleDeploy } from "./commands/deploy.js";
import { handleUserPermit } from "./commands/userPermit.js";
import { handleRegisterPlace } from "./commands/registerPlace.js";
import { handleProjectSet } from "./commands/projectSet.js";
import { handleLoreUpdate } from "./commands/loreUpdate.js";
import { handleLoreRemove } from "./commands/loreRemove.js";
import { handleMemClear } from "./commands/memClear.js";
import { handleHelp } from "./commands/help.js";
import { registerSlashCommands } from "./lib/slashCommands.js";
import { getSentientChannel, getPlaces } from "./lib/db.js";
import { generateResponse } from "./lib/openai.js";
import {
  addToConversationHistory,
  getConversationHistory,
  getPendingPoll,
  deletePendingPoll,
} from "./lib/state.js";
import { hasDeploymentPermission } from "./lib/permissions.js";

const handledMessageIds = new Set<string>();

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Reaction, Partials.Message],
  });
}

export function registerEvents(client: Client): void {
  client.once(Events.ClientReady, async (c) => {
    console.log(`[SIGMA-7] Online — logged in as ${c.user.tag}`);
    console.log(`[SIGMA-7] Serving ${c.guilds.cache.size} guild(s).`);

    const token = process.env["DISCORD_BOT_TOKEN"];
    if (token) {
      await registerSlashCommands(c.user.id, token).catch((err) => {
        console.error("[SIGMA-7] Failed to register slash commands:", err);
      });
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (!message.author || message.author.bot) return;
    if (!message.guild) return;
    if (!message.content) return;

    if (handledMessageIds.has(message.id)) return;
    handledMessageIds.add(message.id);
    setTimeout(() => handledMessageIds.delete(message.id), 30_000);

    await handleSentientChannel(message).catch((err) => {
      console.error("[SIGMA-7] Sentient channel error:", err);
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction as AutocompleteInteraction).catch((err) => {
        console.error("[SIGMA-7] Autocomplete error:", err);
      });
      return;
    }

    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction as ChatInputCommandInteraction, client).catch((err) => {
        console.error("[SIGMA-7] Slash command error:", err);
      });
      return;
    }

    if (interaction.isButton()) {
      await handleButtonInteraction(interaction as ButtonInteraction).catch((err) => {
        console.error("[SIGMA-7] Button interaction error:", err);
      });
      return;
    }
  });
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  switch (interaction.commandName) {
    case "deploymentstart":
      await handleDeploymentStart(interaction, client);
      break;

    case "deploy":
      await handleDeploy(interaction, client);
      break;

    case "deploymentend":
      await handleDeploymentEnd(interaction);
      break;

    case "userpermit":
      await handleUserPermit(interaction);
      break;

    case "registerplace":
      await handleRegisterPlace(interaction);
      break;

    case "projectset":
      await handleProjectSet(interaction);
      break;

    case "loreupdate":
      await handleLoreUpdate(interaction);
      break;

    case "loreremove":
      await handleLoreRemove(interaction);
      break;

    case "memclear":
      await handleMemClear(interaction);
      break;

    case "help":
      await handleHelp(interaction);
      break;

    default:
      break;
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.commandName === "deploymentstart") {
    const focused = interaction.options.getFocused().toLowerCase();
    const places = await getPlaces().catch(() => []);
    const filtered = places
      .filter((p) => p.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(filtered.map((p) => ({ name: p.name, value: p.name })));
  }
}

async function handleSentientChannel(message: Message): Promise<void> {
  if (!message.guild) return;

  const sentientChannel = await getSentientChannel(message.guild.id).catch(() => null);
  if (!sentientChannel) return;

  const isDirectChannel = sentientChannel.channelId === message.channel.id;
  const parentId = message.channel.isThread()
    ? (message.channel as { parentId?: string | null }).parentId
    : null;
  const isForumPost = parentId === sentientChannel.channelId;

  if (!isDirectChannel && !isForumPost) return;

  const channel = message.channel as TextChannel;

  await channel.sendTyping().catch(() => {});

  // Resolve <@userId> mentions to display names
  let resolvedContent = message.content;
  for (const [userId, user] of message.mentions.users) {
    const member = message.guild.members.cache.get(userId);
    const displayName = member?.displayName ?? user.displayName ?? user.username;
    resolvedContent = resolvedContent.replace(new RegExp(`<@!?${userId}>`, "g"), `@${displayName}`);
  }

  // Separate image attachments from other files
  const imageAttachments = [...message.attachments.values()].filter((a) =>
    a.contentType?.startsWith("image/")
  );
  const otherAttachments = [...message.attachments.values()].filter(
    (a) => !a.contentType?.startsWith("image/")
  );

  // Describe non-image files inline so the AI knows they exist
  const fileDescriptions = otherAttachments
    .map((a) => {
      const type = a.contentType ?? "unknown type";
      const isVideo = type.startsWith("video/");
      const label = isVideo ? "Video" : "File";
      return `[${label} attached: ${a.name} (${type})]`;
    })
    .join("\n");

  const fullContent = [resolvedContent, fileDescriptions].filter(Boolean).join("\n");
  const imageUrls = imageAttachments.map((a) => a.url);

  // What gets stored in history (text-only — no image URLs)
  const historyEntry = [
    resolvedContent,
    imageAttachments.length > 0
      ? `[${imageAttachments.length} image(s) attached]`
      : "",
    fileDescriptions,
  ]
    .filter(Boolean)
    .join("\n");

  const history = getConversationHistory(message.channel.id);
  const response = await generateResponse(message.channel.id, fullContent, history, imageUrls);

  console.log(`[SIGMA-7] Response generated (${response.length} chars): ${response.slice(0, 120)}`);

  const safeResponse = response.trim() || "No data available.";

  addToConversationHistory(message.channel.id, "user", historyEntry);
  addToConversationHistory(message.channel.id, "assistant", safeResponse);

  await message.reply(safeResponse);
}

async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;

  const guildId = interaction.guild.id;

  if (interaction.customId === `cancel_poll_${guildId}`) {
    const member =
      interaction.guild.members.cache.get(interaction.user.id) ??
      (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));

    if (!member) {
      await interaction.reply({ content: "⚠️ Could not verify your identity.", ephemeral: true });
      return;
    }

    const permitted = await hasDeploymentPermission(member as GuildMember);
    if (!permitted) {
      await interaction.reply({
        content: "🔒 **Access Denied.** You are not authorized to cancel this deployment.",
        ephemeral: true,
      });
      return;
    }

    const pending = getPendingPoll(guildId);
    if (!pending) {
      await interaction.reply({ content: "⚠️ No active poll found to cancel.", ephemeral: true });
      return;
    }

    clearTimeout(pending.timeoutHandle);
    deletePendingPoll(guildId);

    await interaction.update({
      content: interaction.message.content + `\n\n⛔ **Poll cancelled by <@${interaction.user.id}>.**`,
      components: [],
    });

    const pollChannel = interaction.channel as TextChannel;
    await pollChannel.send(
      `⛔ **Deployment to ${pending.location} has been cancelled by <@${interaction.user.id}>.**`
    );
  }
}
