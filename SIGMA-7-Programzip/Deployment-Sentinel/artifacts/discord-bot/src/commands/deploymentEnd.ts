import { ChatInputCommandInteraction, GuildMember, TextChannel } from "discord.js";
import { getActiveDeployment, deletePendingPoll, getPendingPoll } from "../lib/state.js";
import { hasDeploymentPermission } from "../lib/permissions.js";
import { executeDeploymentEnd } from "../lib/endDeployment.js";

export async function handleDeploymentEnd(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild || !interaction.member) return;

  await interaction.deferReply({ ephemeral: true });

  const member = interaction.member as GuildMember;
  const permitted = await hasDeploymentPermission(member);
  if (!permitted) {
    await interaction.editReply("🔒 **Access Denied.** You do not have authorization to end a deployment.");
    return;
  }

  const pendingPoll = getPendingPoll(interaction.guild.id);
  if (pendingPoll) {
    clearTimeout(pendingPoll.timeoutHandle);
    deletePendingPoll(interaction.guild.id);

    const pollChannel = await interaction.client.channels.fetch(pendingPoll.channelId).catch(() => null);
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
    await interaction.editReply("✅ **Poll cancelled.**");
    return;
  }

  const deployment = getActiveDeployment(interaction.guild.id);
  if (!deployment) {
    await interaction.editReply("⚠️ There is no active deployment or poll to end.");
    return;
  }

  await executeDeploymentEnd(interaction.client, interaction.guild.id, interaction.channelId);
  await interaction.editReply("✅ **Deployment ended. Mission report posted.**");
}
