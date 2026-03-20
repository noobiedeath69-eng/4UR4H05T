import { Message, TextChannel } from "discord.js";
import { getActiveDeployment, deleteActiveDeployment, deletePendingPoll, getPendingPoll } from "../lib/state.js";
import { hasDeploymentPermission } from "../lib/permissions.js";
import { endDeploymentRecord } from "../lib/db.js";
import { stopLiveTimer, calculatePoints, formatDuration } from "../lib/timer.js";

export async function handleDeploymentEnd(message: Message): Promise<void> {
  if (!message.guild || !message.member) return;

  const permitted = await hasDeploymentPermission(message.member);
  if (!permitted) {
    await message.reply(
      "🔒 **Access Denied.** You do not have authorization to end a deployment."
    );
    return;
  }

  const pendingPoll = getPendingPoll(message.guild.id);
  if (pendingPoll) {
    clearTimeout(pendingPoll.timeoutHandle);
    deletePendingPoll(message.guild.id);

    const pollChannel = await message.client.channels.fetch(pendingPoll.channelId).catch(() => null);
    if (pollChannel && pollChannel.isTextBased()) {
      const textChannel = pollChannel as TextChannel;
      const pollMsg = await textChannel.messages.fetch(pendingPoll.pollMessageId).catch(() => null);
      if (pollMsg) {
        await pollMsg.edit({
          content: pollMsg.content + "\n\n⛔ **Poll cancelled by command.**",
          components: [],
        }).catch(() => {});
      }
      await textChannel.send("⛔ **Deployment poll has been manually cancelled.**");
    }
    return;
  }

  const deployment = getActiveDeployment(message.guild.id);
  if (!deployment) {
    await message.reply("⚠️ There is no active deployment or poll to end.");
    return;
  }

  stopLiveTimer(message.guild.id);
  deleteActiveDeployment(message.guild.id);
  await endDeploymentRecord(deployment.id);

  const endedAt = new Date();
  const totalMs = endedAt.getTime() - deployment.startedAt.getTime();
  const totalDuration = formatDuration(totalMs);
  const points = calculatePoints(deployment.startedAt, endedAt);

  const channel = message.channel as TextChannel;
  const pollChannel = await message.client.channels
    .fetch(deployment.channelId)
    .catch(() => null);
  const textPollChannel = (pollChannel && pollChannel.isTextBased() ? pollChannel : channel) as TextChannel;

  const pollMessage = await textPollChannel.messages
    .fetch(deployment.pollMessageId)
    .catch(() => null);

  const attendeeMentions: string[] = [];
  if (pollMessage) {
    const reaction = pollMessage.reactions.cache.get("✅");
    if (reaction) {
      const users = await reaction.users.fetch().catch(() => null);
      if (users) {
        users.filter((u) => !u.bot).forEach((u) => {
          attendeeMentions.push(`<@${u.id}>`);
        });
      }
    }

    await pollMessage.edit({
      content: pollMessage.content,
      components: [],
    }).catch(() => {});
  }

  const typeLabel = deployment.type.toUpperCase();
  const location = deployment.location;

  const attendeeList =
    attendeeMentions.length > 0
      ? attendeeMentions.join(", ")
      : "*No confirmed attendees recorded.*";

  const extractionMsg = [
    `📡 **All divisions may now extract from ${location} and return to Site-∆ for maintenance and refit.**`,
    `Allied Site/Faction Reconnaissance systems are **offline**; ensure all encrypted field-links are severed and local presence is neutralized.`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📋 **Mission Report**`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `**📍 Location:** ${location}`,
    `**🔴 Operation Type:** ${typeLabel}`,
    `**⏱ Total Duration:** ${totalDuration}`,
    `**⭐ Points Earned:** ${points} point${points !== 1 ? "s" : ""}`,
    ``,
    `**✅ Deployment Attendees:**`,
    attendeeList,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ].join("\n");

  await channel.send(extractionMsg);
}
