import { Message, TextChannel } from "discord.js";
import { getActiveDeployment, deletePendingPoll, getPendingPoll } from "../lib/state.js";
import { hasDeploymentPermission } from "../lib/permissions.js";
import { executeDeploymentEnd } from "../lib/endDeployment.js";

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

  await executeDeploymentEnd(message.client, message.guild.id, message.channel.id);
}
