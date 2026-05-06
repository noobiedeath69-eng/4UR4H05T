import {
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  ForumChannel,
} from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { setSentientChannel } from "../lib/db.js";

export async function handleProjectSet(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      content: "🔒 **Access Denied.** This command is restricted to the bot owner.",
      flags: 1 << 6,
    });
    return;
  }

  const channel = interaction.options.getChannel("channel", true);

  // Acknowledge immediately so Discord doesn't time out while we write to DB
  await interaction.deferReply({ flags: 1 << 6 });

  try {
    await setSentientChannel(interaction.guild.id, channel.id, channel.name);
  } catch (err) {
    console.error("[SIGMA-7] setSentientChannel failed:", err);
    await interaction.editReply("⚠️ Database error while saving channel. Please try again.");
    return;
  }

  await interaction.editReply(
    [
      `✅ **SIGMA-7 stationed in <#${channel.id}>.**`,
      ``,
      `SIGMA-7 will now monitor and respond to messages in that channel.`,
      `Reconnaissance protocols are active.`,
    ].join("\n")
  );

  // Announce in the channel itself (text channels only)
  if (channel.type === ChannelType.GuildText) {
    await (channel as TextChannel)
      .send(
        [
          `**[SIGMA-7 ONLINE]**`,
          ``,
          `Designation: SIGMA-7 | MTF Lambda-13 "The Onlookers" — Intelligence & Analysis Unit`,
          ``,
          `All communications within this channel are now monitored. I am operational and standing by for Foundation-related queries, operational support, or general inquiries. Proceed at your discretion.`,
        ].join("\n")
      )
      .catch(() => {});
  }
}
