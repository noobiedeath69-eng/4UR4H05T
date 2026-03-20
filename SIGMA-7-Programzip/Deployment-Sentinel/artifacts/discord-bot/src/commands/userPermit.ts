import { Message } from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { addWhitelistedUser, addWhitelistedRole } from "../lib/db.js";

export async function handleUserPermit(message: Message): Promise<void> {
  if (!message.guild) return;

  if (!isOwner(message.author.id)) {
    await message.reply("🔒 **Access Denied.** This command is restricted to the bot owner.");
    return;
  }

  const mentionedRole = message.mentions.roles.first();
  if (mentionedRole) {
    await addWhitelistedRole(mentionedRole.id, mentionedRole.name);
    await message.reply(
      [
        `✅ **Deployment Command Access Granted to <@&${mentionedRole.id}>.**`,
        ``,
        `\` Authorization logged. MTF Lambda-13 deployment roster updated.\``,
      ].join("\n")
    );
    return;
  }

  const mentionedUser = message.mentions.users.first();
  if (!mentionedUser) {
    await message.reply(
      "⚠️ Please mention a user or role. Usage: `!userpermit @User` or `!userpermit @Role`"
    );
    return;
  }

  if (mentionedUser.bot) {
    await message.reply("⚠️ Bot accounts cannot be whitelisted.");
    return;
  }

  await addWhitelistedUser(mentionedUser.id, mentionedUser.username);

  await message.reply(
    [
      `✅ **Access Granted.**`,
      `<@${mentionedUser.id}> (**${mentionedUser.username}**) has been authorized to use deployment commands.`,
      ``,
      `\`-# Authorization logged. MTF Lambda-13 deployment roster updated.\``,
    ].join("\n")
  );
}
