import { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { isOwner, isServerAdmin } from "../lib/permissions.js";
import { addPlace } from "../lib/db.js";

export async function handleRegisterPlace(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  const member = interaction.member as GuildMember;
  if (!isOwner(interaction.user.id) && !isServerAdmin(member)) {
    await interaction.reply({
      content: "🔒 **Access Denied.** This command is restricted to administrators.",
      ephemeral: true,
    });
    return;
  }

  const name = interaction.options.getString("name", true).trim();

  await addPlace(name);

  await interaction.reply({
    content: [
      `✅ **Location Registered: ${name}**`,
      `-# This location is now available as an autocomplete option in /deploymentstart.`,
    ].join("\n"),
  });
}
