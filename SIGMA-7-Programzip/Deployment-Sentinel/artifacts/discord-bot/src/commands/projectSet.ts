import {
  Message,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  ComponentType,
  TextChannel,
} from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { setSentientChannel } from "../lib/db.js";

export async function handleProjectSet(message: Message): Promise<void> {
  if (!message.guild || !message.member) return;

  if (!isOwner(message.author.id)) {
    await message.reply("🔒 **Access Denied.** This command is restricted to the bot owner.");
    return;
  }

  const textChannels = message.guild.channels.cache
    .filter(
      (ch) =>
        ch.type === ChannelType.GuildText &&
        ch.viewable
    )
    .map((ch) => ch as TextChannel)
    .sort((a, b) => a.position - b.position)
    .slice(0, 25);

  if (textChannels.length === 0) {
    await message.reply("⚠️ No accessible text channels found in this server.");
    return;
  }

  const options = textChannels.map((ch) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`#${ch.name}`)
      .setValue(ch.id)
      .setDescription(ch.topic ? ch.topic.slice(0, 100) : `Channel ID: ${ch.id}`)
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("projectset_channel_select")
    .setPlaceholder("Select a channel to station SIGMA-7...")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const selectMsg = await message.reply({
    content: "**📡 SIGMA-7 Channel Assignment**\nSelect the channel where SIGMA-7 will be stationed:",
    components: [row],
  });

  const collector = selectMsg.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: 60_000,
    filter: (interaction) => interaction.user.id === message.author.id,
  });

  collector.on("collect", async (interaction) => {
    if (!message.guild) return;
    const channelId = interaction.values[0];
    if (!channelId) return;

    const selected = message.guild.channels.cache.get(channelId) as TextChannel | undefined;
    if (!selected) {
      await interaction.reply({ content: "⚠️ Channel not found.", ephemeral: true });
      return;
    }

    await setSentientChannel(message.guild.id, channelId, selected.name);

    await interaction.update({
      content: [
        `✅ **SIGMA-7 stationed in <#${channelId}>.**`,
        ``,
        `SIGMA-7 will now monitor and respond to all messages in that channel. Reconnaissance protocols are active.`,
      ].join("\n"),
      components: [],
    });

    await selected.send(
      [
        `**[SIGMA-7 ONLINE]**`,
        ``,
        `Designation: SIGMA-7 | MTF Lambda-13 "The Onlookers" — Intelligence & Analysis Unit`,
        ``,
        `All communications within this channel are now monitored. I am operational and standing by for Foundation-related queries, operational support, or general inquiries. Proceed at your discretion.`,
      ].join("\n")
    );

    collector.stop();
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      selectMsg.edit({ content: "⌛ Channel selection timed out.", components: [] }).catch(() => {});
    }
  });
}
