import {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  TextChannel,
  ForumChannel,
} from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { setSentientChannel } from "../lib/db.js";

// Pending project set selections keyed by userId → { guildId, timer }
const pending = new Map<string, { guildId: string; timer: ReturnType<typeof setTimeout>; interaction: ChatInputCommandInteraction }>();

export async function handleProjectSet(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  const callerId = interaction.user.id;
  console.log(`[SIGMA-7] /projectset called by ${callerId}`);

  if (!isOwner(callerId)) {
    await interaction.reply({
      content: `🔒 **Access Denied.** This command is restricted to the bot owner.`,
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

  // Clear any previous pending entry for this user
  const existing = pending.get(callerId);
  if (existing) clearTimeout(existing.timer);

  // Store state; auto-expire after 60s
  const timer = setTimeout(() => {
    if (pending.has(callerId)) {
      pending.delete(callerId);
      interaction.editReply({ content: "⌛ Channel selection timed out.", components: [] }).catch(() => {});
    }
  }, 60_000);

  pending.set(callerId, { guildId: interaction.guild.id, timer, interaction });
}

export async function handleProjectSetSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const entry = pending.get(interaction.user.id);
  if (!entry) {
    await interaction.reply({ content: "⚠️ Session expired. Run /projectset again.", ephemeral: true });
    return;
  }

  clearTimeout(entry.timer);
  pending.delete(interaction.user.id);

  const channelId = interaction.values[0];
  if (!channelId || !interaction.guild) {
    await interaction.update({ content: "⚠️ Invalid selection.", components: [] });
    return;
  }

  const selected = interaction.guild.channels.cache.get(channelId) as TextChannel | ForumChannel | undefined;
  if (!selected) {
    await interaction.update({ content: "⚠️ Channel not found.", components: [] });
    return;
  }

  await setSentientChannel(interaction.guild.id, channelId, selected.name);

  await interaction.update({
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
    ).catch(() => {});
  }
}
