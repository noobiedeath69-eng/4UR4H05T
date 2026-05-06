import {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  TextChannel,
  ForumChannel,
  GuildChannel,
} from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { setSentientChannel } from "../lib/db.js";

// Pending project-set selections keyed by userId
const pending = new Map<string, {
  guildId: string;
  timer: ReturnType<typeof setTimeout>;
  interaction: ChatInputCommandInteraction;
}>();

export async function handleProjectSet(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  const callerId = interaction.user.id;

  if (!isOwner(callerId)) {
    await interaction.reply({
      content: `🔒 **Access Denied.** This command is restricted to the bot owner.`,
      ephemeral: true,
    });
    return;
  }

  // Fetch all channels into cache so .cache.get() works later
  const channelCache = await interaction.guild.channels.fetch().catch(() => interaction.guild!.channels.cache);

  const eligible = [...channelCache.values()]
    .filter((ch): ch is TextChannel | ForumChannel =>
      ch !== null &&
      (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildForum) &&
      (ch as GuildChannel).viewable === true
    )
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .slice(0, 25);

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

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("projectset_channel_select")
      .setPlaceholder("Select a channel to station SIGMA-7...")
      .addOptions(options)
  );

  await interaction.reply({
    content: "**📡 SIGMA-7 Channel Assignment**\nSelect the channel where SIGMA-7 will be stationed:",
    components: [row],
    ephemeral: true,
  });

  // Clear any stale pending entry for this user
  const existing = pending.get(callerId);
  if (existing) clearTimeout(existing.timer);

  // Auto-expire after 60 s
  const timer = setTimeout(() => {
    if (pending.has(callerId)) {
      pending.delete(callerId);
      interaction.editReply({ content: "⌛ Channel selection timed out.", components: [] }).catch(() => {});
    }
  }, 60_000);

  pending.set(callerId, { guildId: interaction.guild.id, timer, interaction });
}

export async function handleProjectSetSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  // Acknowledge immediately to prevent the 3-second Discord timeout
  await interaction.deferUpdate();

  const entry = pending.get(interaction.user.id);
  if (!entry) {
    await interaction.editReply({ content: "⚠️ Session expired. Run **/projectset** again.", components: [] });
    return;
  }

  clearTimeout(entry.timer);
  pending.delete(interaction.user.id);

  const channelId = interaction.values[0];
  if (!channelId || !interaction.guild) {
    await interaction.editReply({ content: "⚠️ Invalid selection.", components: [] });
    return;
  }

  // Try cache first, then fetch to be safe
  let selected: TextChannel | ForumChannel | null =
    (interaction.guild.channels.cache.get(channelId) as TextChannel | ForumChannel | undefined) ?? null;

  if (!selected) {
    const fetched = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (fetched && (fetched.type === ChannelType.GuildText || fetched.type === ChannelType.GuildForum)) {
      selected = fetched as TextChannel | ForumChannel;
    }
  }

  if (!selected) {
    await interaction.editReply({ content: "⚠️ Channel not found or inaccessible.", components: [] });
    return;
  }

  try {
    await setSentientChannel(interaction.guild.id, channelId, selected.name);
  } catch (err) {
    console.error("[SIGMA-7] setSentientChannel failed:", err);
    await interaction.editReply({
      content: "⚠️ Database error while saving channel. Please try again.",
      components: [],
    });
    return;
  }

  await interaction.editReply({
    content: [
      `✅ **SIGMA-7 stationed in <#${channelId}>.**`,
      ``,
      `SIGMA-7 will now monitor and respond to all messages in that channel.`,
    ].join("\n"),
    components: [],
  });

  if (selected.type === ChannelType.GuildText) {
    await (selected as TextChannel).send(
      [
        `**[SIGMA-7 ONLINE]**`,
        ``,
        `Designation: SIGMA-7 | MTF Lambda-13 "The Onlookers" — Intelligence & Analysis Unit`,
        ``,
        `All communications within this channel are now monitored. I am operational and standing by.`,
      ].join("\n")
    ).catch(() => {});
  }
}
