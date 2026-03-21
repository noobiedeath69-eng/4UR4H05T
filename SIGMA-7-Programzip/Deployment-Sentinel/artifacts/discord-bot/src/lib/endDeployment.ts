import { Client, TextChannel } from "discord.js";
import { getActiveDeployment, deleteActiveDeployment } from "./state.js";
import { endDeploymentRecord } from "./db.js";
import { stopLiveTimer, calculatePoints, formatDuration } from "./timer.js";

export async function executeDeploymentEnd(
  client: Client,
  guildId: string,
  reportChannelId: string
): Promise<void> {
  const deployment = getActiveDeployment(guildId);
  if (!deployment) return;

  if (deployment.autoEndHandle) {
    clearTimeout(deployment.autoEndHandle);
  }

  stopLiveTimer(guildId);
  deleteActiveDeployment(guildId);
  await endDeploymentRecord(deployment.id);

  const endedAt = new Date();
  const totalMs = endedAt.getTime() - deployment.startedAt.getTime();
  const totalDuration = formatDuration(totalMs);
  const points = calculatePoints(deployment.startedAt, endedAt);

  const deploymentChannel = await client.channels.fetch(deployment.channelId).catch(() => null);
  const reportChannel = await client.channels.fetch(reportChannelId).catch(() => null);
  const textDeploymentChannel = deploymentChannel?.isTextBased() ? deploymentChannel as TextChannel : null;
  const textReportChannel = (reportChannel?.isTextBased() ? reportChannel : textDeploymentChannel) as TextChannel | null;

  if (!textReportChannel) return;

  const pollMessage = textDeploymentChannel
    ? await textDeploymentChannel.messages.fetch(deployment.pollMessageId).catch(() => null)
    : null;

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
    await pollMessage.edit({ content: pollMessage.content, components: [] }).catch(() => {});
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

  await textReportChannel.send(extractionMsg);
}
