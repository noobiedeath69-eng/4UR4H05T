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
    description: "Register a location for /deploymentstart (admins only)",
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
];

export async function registerSlashCommands(clientId: string, token: string): Promise<void> {
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commandDefinitions });
  console.log("[SIGMA-7] Slash commands registered globally.");
}
