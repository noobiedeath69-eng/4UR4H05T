import { ChatInputCommandInteraction } from "discord.js";

const HELP_TEXT = [
  "**[SIGMA-7 // COMMAND REFERENCE]**",
  "",
  "**— Deployment Operations —**",
  "`/deploymentstart <place>` — Start a deployment poll for the specified location. Autocompletes from registered places.",
  "`/deploy` — Force-skip the active poll timer and begin the deployment immediately using current ✅ reactions.",
  "`/deploymentend` — End the active deployment and post a mission report, or cancel the current poll.",
  "",
  "**— Administration —**",
  "`/registerplace <name>` — Register a location for `/deploymentstart` autocomplete. Requires admin or owner.",
  "`/userpermit <@user or @role>` — Grant a user or role access to deployment commands. Requires admin or owner.",
  "",
  "**— SIGMA-7 Configuration (owner only) —**",
  "`/projectset` — Assign SIGMA-7 to a text or forum channel where it will monitor and respond to all messages.",
  "`/loreupdate list` — List all intelligence documents currently loaded into SIGMA-7's memory.",
  "`/loreupdate add <url> [name]` — Load a Google Docs document into SIGMA-7's knowledge base.",
  "`/loreupdate refresh` — Re-fetch and re-synchronize all loaded intelligence documents from their sources.",
  "`/loreremove [number]` — Remove an intelligence document by its list number. Omit number to list documents.",
  "`/memclear` — Clear SIGMA-7's conversation memory for the current channel.",
  "",
  "`/help` — Display this command reference.",
].join("\n");

export async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: HELP_TEXT, ephemeral: true });
}
