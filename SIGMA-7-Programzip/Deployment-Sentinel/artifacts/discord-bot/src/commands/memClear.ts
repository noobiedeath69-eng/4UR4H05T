import { ChatInputCommandInteraction } from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { clearConversationHistory } from "../lib/state.js";

export async function handleMemClear(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      content: "🔒 **Access Denied.** This command is restricted to the bot owner.",
      ephemeral: true,
    });
    return;
  }

  clearConversationHistory(interaction.channelId);
  await interaction.reply({
    content: "**[SIGMA-7]** Conversation memory cleared for this channel.",
    ephemeral: true,
  });
}
