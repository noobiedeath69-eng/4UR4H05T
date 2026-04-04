import { ChatInputCommandInteraction } from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { refreshAllLore, upsertLoreDocument, listLoreDocs, toExportUrl } from "../lib/lore.js";

export async function handleLoreUpdate(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({
      content: "**[SIGMA-7 // CLEARANCE DENIED]**\nThis command is restricted to O5-authorized personnel only.",
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand(true);

  if (sub === "list") {
    const docs = await listLoreDocs();

    if (docs.length === 0) {
      await interaction.reply({
        content:
          "**[SIGMA-7 // INTELLIGENCE ARCHIVE]**\nNo classified documents are currently loaded.\n\nUse `/loreupdate add` to upload a Foundation dossier.",
        ephemeral: true,
      });
      return;
    }

    const list = docs
      .map(
        (d, i) =>
          `**${i + 1}.** ${d.name}\n   *Last synchronized: <t:${Math.floor(d.lastFetched.getTime() / 1000)}:R>*`
      )
      .join("\n");

    await interaction.reply({
      content:
        `**[SIGMA-7 // INTELLIGENCE ARCHIVE — ${docs.length} DOCUMENT(S) ON FILE]**\n\n${list}\n\n` +
        "`/loreupdate add` — Upload a new dossier\n" +
        "`/loreupdate refresh` — Re-synchronize all documents\n" +
        "`/loreremove` — Purge a document from memory",
      ephemeral: true,
    });
    return;
  }

  if (sub === "refresh") {
    await interaction.deferReply({ ephemeral: true });
    const results = await refreshAllLore();

    const report = results
      .map((r) => (r.ok ? `✅ ${r.name}` : `❌ ${r.name} — ${r.error}`))
      .join("\n");

    await interaction.editReply(
      `**[SIGMA-7 // SYNC COMPLETE]**\n${report}\n\nAll operational intelligence has been updated. SIGMA-7 is current.`
    );
    return;
  }

  if (sub === "add") {
    const rawUrl = interaction.options.getString("url", true);
    const docName =
      interaction.options.getString("name") || `Classified Document ${Date.now()}`;

    if (!rawUrl.startsWith("http")) {
      await interaction.reply({
        content: "**[SIGMA-7 // INPUT ERROR]**\nProvide a valid document URL.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const exportUrl = toExportUrl(rawUrl);

    try {
      await upsertLoreDocument(docName, exportUrl);
      await interaction.editReply(
        `**[SIGMA-7 // UPLOAD CONFIRMED]**\nDossier loaded: **${docName}**\nSIGMA-7 has integrated this intelligence into the active briefing. All future responses will reflect this update.`
      );
    } catch (err) {
      console.error("[LORE] Failed to fetch/store document:", err);
      await interaction.editReply(
        "**[SIGMA-7 // RETRIEVAL FAILED]**\nUnable to access the document. Verify that the file is publicly accessible (Share → Anyone with the link → Viewer) and try again."
      );
    }
  }
}
