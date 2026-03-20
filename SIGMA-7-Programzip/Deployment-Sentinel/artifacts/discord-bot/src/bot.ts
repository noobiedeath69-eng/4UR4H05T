import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  Message,
  ButtonInteraction,
  StringSelectMenuInteraction,
  TextChannel,
} from "discord.js";
import { handleDeploymentStart } from "./commands/deploymentStart.js";
import { handleDeploymentEnd } from "./commands/deploymentEnd.js";
import { handleProjectSet } from "./commands/projectSet.js";
import { handleUserPermit } from "./commands/userPermit.js";
import { handleLoreUpdate } from "./commands/loreUpdate.js";
import { handleLoreRemove } from "./commands/loreRemove.js";
import { handleMemClear } from "./commands/memClear.js";
import { getSentientChannel } from "./lib/db.js";
import { generateResponse } from "./lib/openai.js";
import {
  addToConversationHistory,
  getConversationHistory,
  getPendingPoll,
  deletePendingPoll,
} from "./lib/state.js";
import { hasDeploymentPermission } from "./lib/permissions.js";

const PREFIX = "!";

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
  client.once(Events.ClientReady, (c) => {
    console.log(`[SIGMA-7] Online — logged in as ${c.user.tag}`);
    console.log(`[SIGMA-7] Serving ${c.guilds.cache.size} guild(s).`);
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (!message.author || message.author.bot) return;
    if (!message.guild) return;
    if (!message.content) return;

    if (handledMessageIds.has(message.id)) return;
    handledMessageIds.add(message.id);
    setTimeout(() => handledMessageIds.delete(message.id), 30_000);

    if (message.content.startsWith(PREFIX)) {
      await handleCommand(message, client).catch((err) => {
        console.error("[SIGMA-7] Command error:", err);
      });
      return;
    }

    await handleSentientChannel(message).catch((err) => {
      console.error("[SIGMA-7] Sentient channel error:", err);
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction as ButtonInteraction).catch((err) => {
        console.error("[SIGMA-7] Button interaction error:", err);
      });
      return;
    }
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenuInteraction(interaction as StringSelectMenuInteraction).catch((err) => {
        console.error("[SIGMA-7] Select menu error:", err);
      });
    }
  });
}

async function handleCommand(message: Message, client: Client): Promise<void> {
  const content = message.content.slice(PREFIX.length).trim();
  const [command, ...args] = content.split(/\s+/);
  const cmd = command?.toLowerCase();

  switch (cmd) {
    case "deploymentstart":
      await handleDeploymentStart(message, args, client);
      break;

    case "deploymentend":
      await handleDeploymentEnd(message);
      break;

    case "projectset":
      await handleProjectSet(message);
      break;

    case "userpermit":
      await handleUserPermit(message);
      break;

    case "loreupdate":
      await handleLoreUpdate(message, args);
      break;

    case "loreremove":
      await handleLoreRemove(message, args);
      break;

    case "memclear":
      await handleMemClear(message);
      break;

    default:
      break;
  }
}

async function handleSentientChannel(message: Message): Promise<void> {
  if (!message.guild) return;

  const sentientChannel = await getSentientChannel(message.guild.id).catch(() => null);
  if (!sentientChannel) return;
  if (sentientChannel.channelId !== message.channel.id) return;

  const channel = message.channel as TextChannel;

  await channel.sendTyping().catch(() => {});

  const history = getConversationHistory(message.channel.id);
  const response = await generateResponse(
    message.channel.id,
    message.content,
    history
  );

  console.log(`[SIGMA-7] Response generated (${response.length} chars): ${response.slice(0, 120)}`);

  const safeResponse = response.trim() || "No data available.";

  addToConversationHistory(message.channel.id, "user", message.content);
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

    const permitted = await hasDeploymentPermission(member);
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

async function handleSelectMenuInteraction(
  _interaction: StringSelectMenuInteraction
): Promise<void> {
  // Handled inline in projectSet.ts via collectors
}
