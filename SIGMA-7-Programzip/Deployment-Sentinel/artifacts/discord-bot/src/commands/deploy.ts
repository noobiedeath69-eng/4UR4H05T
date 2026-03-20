import { Message, TextChannel, Client } from "discord.js";
import {
  getPendingPoll,
  getActiveDeployment,
  setActiveDeployment,
} from "../lib/state.js";
import { hasDeploymentPermission } from "../lib/permissions.js";
import {
  createDeploymentRecord,
  updateDeploymentPhase,
} from "../lib/db.js";
import { startLiveTimer, buildStartMessage } from "../lib/timer.js";

export async function handleDeploy(
  message: Message,
  args: string[],
  _client: Client
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
      "⚠️ A deployment poll is already active. Wait for it to conclude or use `!deploymentend` to cancel it first."
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
      "⚠️ Please specify a location. Usage: `!deploy [Location]`\nExample: `!deploy Site-Jacoby`"
    );
    return;
  }

  const channel = message.channel as TextChannel;
  const startedAt = new Date();

  const record = await createDeploymentRecord({
    guildId: message.guild.id,
    location,
    type: "deployment",
    channelId: message.channel.id,
    pollMessageId: "direct",
    pollStartedAt: startedAt,
    startedByUserId: message.author.id,
    startedByUsername: message.author.username,
    active: true,
    phase: "active",
  });

  const startContent = buildStartMessage(
    location,
    "deployment",
    message.author.id,
    1,
    startedAt
  );
  const startMsg = await channel.send(startContent);

  let thread = null;
  try {
    thread = await channel.threads.create({
      name: `DEPLOYMENT — ${location}`,
      startMessage: startMsg,
      autoArchiveDuration: 60,
    });
    await thread.send(
      `**📋 DEPLOYMENT THREAD — ${location}**\nAll operational communications for this mission should be logged here.\nCommanding Officer: <@${message.author.id}>`
    );
  } catch {
    // Thread creation failed — non-fatal
  }

  const deployment = {
    id: record.id,
    guildId: message.guild.id,
    channelId: message.channel.id,
    pollMessageId: null,
    timerMessageId: startMsg.id,
    threadId: thread?.id ?? null,
    location,
    type: "deployment",
    startedAt,
    startedByUserId: message.author.id,
    startedByUsername: message.author.username,
    intervalHandle: undefined as unknown as ReturnType<typeof setInterval>,
  };
  setActiveDeployment(message.guild.id, deployment);

  await updateDeploymentPhase(record.id, "active", {
    type: "deployment",
    startedAt,
    timerMessageId: startMsg.id,
    threadId: thread?.id,
  });

  await startLiveTimer(startMsg, message.guild.id);
}
