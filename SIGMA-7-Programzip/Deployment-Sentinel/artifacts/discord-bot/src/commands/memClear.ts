import { Message } from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { clearConversationHistory } from "../lib/state.js";

export async function handleMemClear(message: Message): Promise<void> {
  if (!isOwner(message.author.id)) {
    await message.reply("Access denied.");
    return;
  }

  clearConversationHistory(message.channel.id);
  await message.reply("SIGMA-7: Conversation memory cleared for this channel.");
}
