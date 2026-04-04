import { ChatInputCommandInteraction, GuildMember, Client } from "discord.js";
import { getPendingPoll, getActiveDeployment, deletePendingPoll } from "../lib/state.js";
import { hasDeploymentPermission } from "../lib/permissions.js";
import { resolvePoll } from "./deploymentStart.js";

export async function handleDeploy(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  if (!interaction.guild || !interaction.member) return;

  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member as GuildMember;
  const permitted = await hasDeploymentPermission(member);
  if (!permitted) {
    await interaction.editReply("🔒 **Access Denied.** You do not have authorization to force a deployment.");
    return;
  }

  if (getActiveDeployment(interaction.guild.id)) {
    await interaction.editReply("⚠️ A deployment is already active. Use `/deploymentend` to conclude it first.");
    return;
  }

  const pending = getPendingPoll(interaction.guild.id);
  if (!pending) {
    await interaction.editReply("⚠️ No active deployment poll to force-start. Use `/deploymentstart` to open a poll first.");
    return;
  }

  clearTimeout(pending.timeoutHandle);
  deletePendingPoll(interaction.guild.id);

  await interaction.editReply("⚡ **Forcing deployment — skipping poll timer. Reading current reactions...**");

  await resolvePoll(
    client,
    pending.guildId,
    pending.channelId,
    pending.pollMessageId,
    pending.location,
    pending.startedByUserId,
    pending.startedByUsername,
    pending.pollStartedAt
  );
}
