import { Message } from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { refreshAllLore, upsertLoreDocument, listLoreDocs, toExportUrl } from "../lib/lore.js";

export async function handleLoreUpdate(message: Message, args: string[]): Promise<void> {
  if (!isOwner(message.author.id)) {
    await message.reply(
      "**[SIGMA-7 // CLEARANCE DENIED]**\nThis command is restricted to O5-authorized personnel only."
    );
    return;
  }

  if (args.length === 0) {
    const docs = await listLoreDocs();

    if (docs.length === 0) {
      await message.reply(
        "**[SIGMA-7 // INTELLIGENCE ARCHIVE]**\nNo classified documents are currently loaded.\n\nUse `!loreupdate <url> [name]` to upload a Foundation dossier."
      );
      return;
    }

    const list = docs
      .map((d, i) => `**${i + 1}.** ${d.name}\n   *Last synchronized: <t:${Math.floor(d.lastFetched.getTime() / 1000)}:R>*`)
      .join("\n");

    await message.reply(
      `**[SIGMA-7 // INTELLIGENCE ARCHIVE — ${docs.length} DOCUMENT(S) ON FILE]**\n\n${list}\n\n` +
      `\`!loreupdate <url> [name]\` — Upload a new dossier\n` +
      `\`!loreupdate refresh\` — Re-synchronize all documents\n` +
      `\`!loreremove <number>\` — Purge a document from memory`
    );
    return;
  }

  if (args[0]?.toLowerCase() === "refresh") {
    const statusMsg = await message.reply("**[SIGMA-7]** Re-synchronizing intelligence archive...");
    const results = await refreshAllLore();

    const report = results
      .map((r) => (r.ok ? `✅ ${r.name}` : `❌ ${r.name} — ${r.error}`))
      .join("\n");

    await statusMsg.edit(
      `**[SIGMA-7 // SYNC COMPLETE]**\n${report}\n\nAll operational intelligence has been updated. SIGMA-7 is current.`
    );
    return;
  }

  const rawUrl = args[0];
  if (!rawUrl?.startsWith("http")) {
    await message.reply(
      "**[SIGMA-7 // INPUT ERROR]**\nProvide a valid document URL, or use `!loreupdate refresh` to re-synchronize existing files."
    );
    return;
  }

  const exportUrl = toExportUrl(rawUrl);
  const docName = args.slice(1).join(" ") || `Classified Document ${Date.now()}`;
  const statusMsg = await message.reply(`**[SIGMA-7]** Retrieving dossier: \`${docName}\`...`);

  try {
    await upsertLoreDocument(docName, exportUrl);
    await statusMsg.edit(
      `**[SIGMA-7 // UPLOAD CONFIRMED]**\nDossier loaded: **${docName}**\nSIGMA-7 has integrated this intelligence into the active briefing. All future responses will reflect this update.`
    );
  } catch (err) {
    console.error("[LORE] Failed to fetch/store document:", err);
    await statusMsg.edit(
      `**[SIGMA-7 // RETRIEVAL FAILED]**\nUnable to access the document. Verify that the file is publicly accessible (Share → Anyone with the link → Viewer) and try again.`
    );
  }
}
