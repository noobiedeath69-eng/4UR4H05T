import {
  ChatInputCommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  ComponentType,
  TextChannel,
  ForumChannel,
} from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { setSentientChannel } from "../lib/db.js";

export async function handleProjectSet(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  const ownerId = process.env["OWNER_DISCORD_ID"];
  const callerId = interaction.user.id;
  console.log(`[SIGMA-7] /projectset called by ${callerId} | OWNER_DISCORD_ID="${ownerId ?? "(not set)"}"`);

  if (!isOwner(callerId)) {
    await interaction.reply({
      content: `🔒 **Access Denied.** This command is restricted to the bot owner.\n\`Your ID: ${callerId}\``,
      ephemeral: true,
    });
    return;
  }

  const channelCache = await interaction.guild.channels.fetch().catch(() => interaction.guild!.channels.cache);

  const eligible = [...channelCache.values()]
    .filter(
      (ch) =>
        ch !== null &&
        (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildForum) &&
        ch.viewable
    )
    .sort((a, b) => (a!.position ?? 0) - (b!.position ?? 0))
    .slice(0, 25) as (TextChannel | ForumChannel)[];

  if (eligible.length === 0) {
    await interaction.reply({
      content: "⚠️ No accessible text or forum channels found in this server.",
      ephemeral: true,
    });
    return;
  }

  const options = eligible.map((ch) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${ch.type === ChannelType.GuildForum ? "🗂️" : "#"}${ch.name}`)
      .setValue(ch.id)
      .setDescription(
        "topic" in ch && ch.topic
          ? (ch.topic as string).slice(0, 100)
          : `Channel ID: ${ch.id}`
      )
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("projectset_channel_select")
    .setPlaceholder("Select a channel to station SIGMA-7...")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.reply({
    content: "**📡 SIGMA-7 Channel Assignment**\nSelect the channel where SIGMA-7 will be stationed:",
    components: [row],
    ephemeral: true,
  });

  let selectInteraction;
  try {
    selectInteraction = await interaction.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 60_000,
      filter: (i) => i.user.id === interaction.user.id,
    });
  } catch {
    await interaction.editReply({ content: "⌛ Channel selection timed out.", components: [] }).catch(() => {});
    return;
  }

  if (!interaction.guild) return;
  const channelId = selectInteraction.values[0];
  if (!channelId) return;

  const selected = interaction.guild.channels.cache.get(channelId) as
    | TextChannel
    | ForumChannel
    | undefined;

  if (!selected) {
    await selectInteraction.update({ content: "⚠️ Channel not found.", components: [] });
    return;
  }

  await setSentientChannel(interaction.guild.id, channelId, selected.name);

  await selectInteraction.update({
    content: [
      `✅ **SIGMA-7 stationed in <#${channelId}>.**`,
      ``,
      `SIGMA-7 will now monitor and respond to all messages in that channel. Reconnaissance protocols are active.`,
    ].join("\n"),
    components: [],
  });

  if (selected.type === ChannelType.GuildText) {
    await selected.send(
      [
        `**[SIGMA-7 ONLINE]**`,
        ``,
        `Designation: SIGMA-7 | MTF Lambda-13 "The Onlookers" — Intelligence & Analysis Unit`,
        ``,
        `All communications within this channel are now monitored. I am operational and standing by for Foundation-related queries, operational support, or general inquiries. Proceed at your discretion.`,
      ].join("\n")
    );
  }
}
