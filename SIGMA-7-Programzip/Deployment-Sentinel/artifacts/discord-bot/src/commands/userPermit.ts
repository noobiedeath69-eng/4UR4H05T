import { Message } from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { addWhitelistedUser } from "../lib/db.js";

export async function handleUserPermit(message: Message): Promise<void> {
  if (!message.guild) return;

  if (!isOwner(message.author.id)) {
    await message.reply("🔒 **Access Denied.** This command is restricted to the bot owner.");
    return;
  }

  const mentioned = message.mentions.users.first();
  if (!mentioned) {
    await message.reply(
      "⚠️ Please mention a user. Usage: `!userpermit @User`"
    );
    return;
  }

  if (mentioned.bot) {
    await message.reply("⚠️ Bot accounts cannot be whitelisted.");
    return;
  }

  await addWhitelistedUser(mentioned.id, mentioned.username);

  await message.reply(
    [
      `✅ **Access Granted.**`,
      `<@${mentioned.id}> (**${mentioned.username}**) has been authorized to use deployment commands.`,
      ``,
      `\`-# Authorization logged. MTF Lambda-13 deployment roster updated.\``,
    ].join("\n")
  );
}
