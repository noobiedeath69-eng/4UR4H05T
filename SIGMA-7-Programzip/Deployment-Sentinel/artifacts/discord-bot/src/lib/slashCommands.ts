import { REST, Routes, ApplicationCommandOptionType } from "discord.js";

export const commandDefinitions = [
  {
    name: "deploymentstart",
    description: "Start a deployment poll",
    options: [
      {
        name: "place",
        description: "Location for the deployment",
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "deploy",
    description: "Force-skip the active deployment poll and start immediately",
  },
  {
    name: "deploymentend",
    description: "End the active deployment or cancel the current poll",
  },
  {
    name: "registerplace",
    description: "Register a location for /deploymentstart autocomplete (admins only)",
    options: [
      {
        name: "name",
        description: "Name of the location to register",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
  {
    name: "userpermit",
    description: "Grant deployment command access to a user or role (admins only)",
    options: [
      {
        name: "target",
        description: "User or role to grant access",
        type: ApplicationCommandOptionType.Mentionable,
        required: true,
      },
    ],
  },
  {
    name: "projectset",
    description: "Assign SIGMA-7 to a channel or forum (owner only)",
  },
  {
    name: "loreupdate",
    description: "Manage SIGMA-7 intelligence documents (owner only)",
    options: [
      {
        name: "list",
        description: "List all loaded intelligence documents",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "add",
        description: "Add a new intelligence document from Google Docs",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "url",
            description: "Google Docs URL",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "name",
            description: "Name for the document (optional)",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "refresh",
        description: "Re-synchronize all intelligence documents from source",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },
  {
    name: "loreremove",
    description: "Remove an intelligence document from SIGMA-7's memory (owner only)",
    options: [
      {
        name: "number",
        description: "Document number from /loreupdate list (omit to list documents)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
      },
    ],
  },
  {
    name: "memclear",
    description: "Clear SIGMA-7's conversation memory in this channel (owner only)",
  },
  {
    name: "help",
    description: "Display all available SIGMA-7 commands and their purpose",
  },
];

export async function registerSlashCommands(clientId: string, token: string): Promise<void> {
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commandDefinitions });
  console.log("[SIGMA-7] Slash commands registered globally.");
}
