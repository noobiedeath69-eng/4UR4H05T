import { ChatInputCommandInteraction } from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { listLoreDocs, deleteLoreDocumentById } from "../lib/lore.js";

export async function handleLoreRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      content:
        "**[SIGMA-7 // CLEARANCE DENIED]**\nThis command is restricted to O5-authorized personnel only.",
      ephemeral: true,
    });
    return;
  }

  const docs = await listLoreDocs();
  const number = interaction.options.getInteger("number");

  if (number === null) {
    if (docs.length === 0) {
      await interaction.reply({
        content:
          "**[SIGMA-7 // INTELLIGENCE ARCHIVE]**\nNo classified documents are currently loaded. Nothing to purge.",
        ephemeral: true,
      });
      return;
    }

    const list = docs.map((d, i) => `**${i + 1}.** ${d.name}`).join("\n");

    await interaction.reply({
      content:
        `**[SIGMA-7 // INTELLIGENCE ARCHIVE — ${docs.length} DOCUMENT(S) ON FILE]**\n\n${list}\n\n` +
        "Use `/loreremove number:<#>` to permanently purge a document from SIGMA-7's memory.",
      ephemeral: true,
    });
    return;
  }

  if (number < 1) {
    await interaction.reply({
      content:
        "**[SIGMA-7 // INPUT ERROR]**\nProvide a valid document number. Use `/loreremove` to list all active dossiers.",
      ephemeral: true,
    });
    return;
  }

  const target = docs[number - 1];

  if (!target) {
    await interaction.reply({
      content: `**[SIGMA-7 // NOT FOUND]**\nNo document at position **${number}**. Archive currently holds **${docs.length}** dossier(s).`,
      ephemeral: true,
    });
    return;
  }

  const deleted = await deleteLoreDocumentById(target.id);

  if (deleted) {
    await interaction.reply({
      content: `**[SIGMA-7 // PURGE CONFIRMED]**\nDossier **${target.name}** has been expunged from the intelligence archive. SIGMA-7's operational knowledge has been updated accordingly.`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content:
        "**[SIGMA-7 // PURGE FAILED]**\nDocument could not be removed. It may have already been expunged.",
      ephemeral: true,
    });
  }
}
