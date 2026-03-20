import { Message } from "discord.js";
import { isOwner } from "../lib/permissions.js";
import { listLoreDocs, deleteLoreDocumentById } from "../lib/lore.js";

export async function handleLoreRemove(message: Message, args: string[]): Promise<void> {
  if (!isOwner(message.author.id)) {
    await message.reply(
      "**[SIGMA-7 // CLEARANCE DENIED]**\nThis command is restricted to O5-authorized personnel only."
    );
    return;
  }

  const docs = await listLoreDocs();

  if (args.length === 0) {
    if (docs.length === 0) {
      await message.reply(
        "**[SIGMA-7 // INTELLIGENCE ARCHIVE]**\nNo classified documents are currently loaded. Nothing to purge."
      );
      return;
    }

    const list = docs
      .map((d, i) => `**${i + 1}.** ${d.name}`)
      .join("\n");

    await message.reply(
      `**[SIGMA-7 // INTELLIGENCE ARCHIVE — ${docs.length} DOCUMENT(S) ON FILE]**\n\n${list}\n\n` +
      `Use \`!loreremove <number>\` to permanently purge a document from SIGMA-7's memory.`
    );
    return;
  }

  const index = parseInt(args[0]!, 10);

  if (isNaN(index) || index < 1) {
    await message.reply(
      "**[SIGMA-7 // INPUT ERROR]**\nProvide a valid document number. Use `!loreremove` to list all active dossiers."
    );
    return;
  }

  const target = docs[index - 1];

  if (!target) {
    await message.reply(
      `**[SIGMA-7 // NOT FOUND]**\nNo document at position **${index}**. Archive currently holds **${docs.length}** dossier(s).`
    );
    return;
  }

  const deleted = await deleteLoreDocumentById(target.id);

  if (deleted) {
    await message.reply(
      `**[SIGMA-7 // PURGE CONFIRMED]**\nDossier **${target.name}** has been expunged from the intelligence archive. SIGMA-7's operational knowledge has been updated accordingly.`
    );
  } else {
    await message.reply(
      "**[SIGMA-7 // PURGE FAILED]**\nDocument could not be removed. It may have already been expunged."
    );
  }
}
