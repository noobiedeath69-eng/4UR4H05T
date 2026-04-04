import { ChatInputCommandInteraction, GuildMember, Role, User } from "discord.js";
import { isOwner, isServerAdmin } from "../lib/permissions.js";
import { addWhitelistedUser, addWhitelistedRole } from "../lib/db.js";

export async function handleUserPermit(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  const member = interaction.member as GuildMember;
  if (!isOwner(interaction.user.id) && !isServerAdmin(member)) {
    await interaction.reply({
      content: "🔒 **Access Denied.** This command is restricted to administrators.",
      ephemeral: true,
    });
    return;
  }

  const target = interaction.options.getMentionable("target", true);

  if (target instanceof Role) {
    await addWhitelistedRole(target.id, target.name);
    await interaction.reply({
      content: [
        `✅ **Deployment Command Access Granted to <@&${target.id}>.**`,
        ``,
        `\` Authorization logged. MTF Lambda-13 deployment roster updated.\``,
      ].join("\n"),
    });
    return;
  }

  const user = target instanceof GuildMember ? target.user : (target as User);

  if (user.bot) {
    await interaction.reply({ content: "⚠️ Bot accounts cannot be whitelisted.", ephemeral: true });
    return;
  }

  await addWhitelistedUser(user.id, user.username);
  await interaction.reply({
    content: [
      `✅ **Access Granted.**`,
      `<@${user.id}> (**${user.username}**) has been authorized to use deployment commands.`,
      ``,
      `\`-# Authorization logged. MTF Lambda-13 deployment roster updated.\``,
    ].join("\n"),
  });
}
