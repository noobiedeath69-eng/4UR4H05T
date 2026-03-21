import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  Client,
} from "discord.js";
import {
  getPendingPoll,
  getActiveDeployment,
  setPendingPoll,
  deletePendingPoll,
  setActiveDeployment,
} from "../lib/state.js";
import { executeDeploymentEnd } from "../lib/endDeployment.js";
import { hasDeploymentPermission } from "../lib/permissions.js";
import {
  createDeploymentRecord,
  updateDeploymentPhase,
} from "../lib/db.js";
import { startLiveTimer, buildStartMessage } from "../lib/timer.js";

const POLL_DURATION_MS = 20 * 60 * 1000;
const MIN_REACTIONS_FOR_DEPLOYMENT = 3;

function buildPollMessage(location: string, userId: string): string {
  return [
    `**MTF Lambda-13 "The Onlookers"** is debriefing a deployment to **${location}**, led by <@${userId}>.`,
    ``,
    `All specialized divisions are to initialize combat systems and establish active datalinks for immediate field operations.`,
    ``,
    `✅ **Deploying / En Route**`,
    `❌ **Stationed / Site-Bound**`,
    ``,
    `\` Poll closes in 20 minutes.\``,
    `-# <@1410299393130893312>`,
  ].join("\n");
}

export async function resolvePoll(
  client: Client,
  guildId: string,
  channelId: string,
  pollMessageId: string,
  location: string,
  startedByUserId: string,
  startedByUsername: string,
  pollStartedAt: Date
): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const textChannel = channel as TextChannel;

  const pollMessage = await textChannel.messages.fetch(pollMessageId).catch(() => null);

  let checkCount = 0;
  if (pollMessage) {
    const checkReaction = pollMessage.reactions.cache.get("✅");
    if (checkReaction) {
      const users = await checkReaction.users.fetch();
      const humanUsers = users.filter((u) => !u.bot);
      checkCount = humanUsers.size;
    }
  }

  const opType = checkCount >= MIN_REACTIONS_FOR_DEPLOYMENT ? "DEPLOYMENT" : "PATROL";
  const startedAt = new Date();

  const record = await createDeploymentRecord({
    guildId,
    location,
    type: opType.toLowerCase(),
    channelId,
    pollMessageId,
    pollStartedAt,
    startedByUserId,
    startedByUsername,
    active: true,
    phase: "active",
  });

  const startContent = buildStartMessage(location, opType.toLowerCase(), startedByUserId, checkCount, startedAt);
  const startMsg = await textChannel.send(startContent);

  let thread = null;
  try {
    thread = await textChannel.threads.create({
      name: `${opType} — ${location}`,
      startMessage: startMsg,
      autoArchiveDuration: 60,
    });
    await thread.send(
      `**📋 ${opType} THREAD — ${location}**\nAll operational communications for this mission should be logged here.\nCommanding Officer: <@${startedByUserId}>`
    );
  } catch {
    // Thread creation failed — non-fatal
  }

  const deployment = {
    id: record.id,
    guildId,
    channelId,
    pollMessageId,
    timerMessageId: startMsg.id,
    threadId: thread?.id ?? null,
    location,
    type: opType.toLowerCase(),
    startedAt,
    startedByUserId,
    startedByUsername,
    intervalHandle: undefined as unknown as ReturnType<typeof setInterval>,
  };
  setActiveDeployment(guildId, deployment);

  await updateDeploymentPhase(record.id, "active", {
    type: opType.toLowerCase(),
    startedAt,
    timerMessageId: startMsg.id,
    threadId: thread?.id,
  });

  await startLiveTimer(startMsg, guildId);

  if (opType === "PATROL") {
    const autoEndHandle = setTimeout(async () => {
      console.log(`[SIGMA-7] Patrol auto-ending for guild ${guildId} at ${location}.`);
      await executeDeploymentEnd(client, guildId, channelId);
    }, 30 * 60 * 1000);

    const current = getActiveDeployment(guildId);
    if (current) {
      current.autoEndHandle = autoEndHandle;
      setActiveDeployment(guildId, current);
    }
  }
}

export async function schedulePollResolution(
  client: Client,
  guildId: string,
  channelId: string,
  pollMessageId: string,
  location: string,
  startedByUserId: string,
  startedByUsername: string,
  pollStartedAt: Date,
  delayMs: number
): Promise<void> {
  const timeoutHandle = setTimeout(async () => {
    deletePendingPoll(guildId);
    await resolvePoll(client, guildId, channelId, pollMessageId, location, startedByUserId, startedByUsername, pollStartedAt);
  }, delayMs);

  setPendingPoll(guildId, {
    guildId,
    channelId,
    pollMessageId,
    location,
    startedByUserId,
    startedByUsername,
    pollStartedAt,
    timeoutHandle,
  });
}

export async function handleDeploymentStart(
  message: Message,
  args: string[],
  client: Client
): Promise<void> {
  if (!message.guild || !message.member) return;

  const permitted = await hasDeploymentPermission(message.member);
  if (!permitted) {
    await message.reply(
      "🔒 **Access Denied.** You do not have authorization to initiate a deployment. Contact a server administrator or a whitelisted operator."
    );
    return;
  }

  if (getPendingPoll(message.guild.id)) {
    await message.reply(
      "⚠️ A deployment poll is already active. Wait for it to conclude or cancel it before starting a new one."
    );
    return;
  }

  if (getActiveDeployment(message.guild.id)) {
    await message.reply(
      "⚠️ An active deployment is already in progress. Use `!deploymentend` to conclude it first."
    );
    return;
  }

  const location = args.join(" ").trim();
  if (!location) {
    await message.reply(
      "⚠️ Please specify a location. Usage: `!deploymentstart [Location]`\nExample: `!deploymentstart Site-Jacoby`"
    );
    return;
  }

  const channel = message.channel as TextChannel;
  const pollStartedAt = new Date();

  const pollContent = buildPollMessage(location, message.author.id);
  const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cancel_poll_${message.guild.id}`)
      .setLabel("Cancel Deployment")
      .setStyle(ButtonStyle.Danger)
  );

  const pollMessage = await channel.send({
    content: pollContent,
    components: [cancelRow],
  });

  await pollMessage.react("✅");
  await pollMessage.react("❌");

  try {
    await pollMessage.startThread({
      name: "Inquiries",
      autoArchiveDuration: 60,
    });
  } catch {
    // Thread creation failed — non-fatal
  }

  await schedulePollResolution(
    client,
    message.guild.id,
    message.channel.id,
    pollMessage.id,
    location,
    message.author.id,
    message.author.username,
    pollStartedAt,
    POLL_DURATION_MS
  );
}
