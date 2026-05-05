import { ChatInputCommandInteraction, ActivityType } from "discord.js";
import { isOwner, isServerAdmin } from "../lib/permissions.js";
import { setBotSetting } from "../lib/db.js";

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  invisible: "Invisible",
};

export async function handleSetRecon(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild || !interaction.member) return;

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  if (!member || (!isOwner(interaction.user.id) && !isServerAdmin(member))) {
    await interaction.reply({
      content: "🔒 **Access Denied.** This command requires admin or owner clearance.",
      ephemeral: true,
    });
    return;
  }

  const status = interaction.options.getString("status", true) as
    | "online"
    | "idle"
    | "dnd"
    | "invisible";
  const activity = interaction.options.getString("activity") ?? null;

  // Apply the presence immediately
  interaction.client.user?.setPresence({
    status,
    activities: activity ? [{ name: activity, type: ActivityType.Custom }] : [],
  });

  // Persist so it survives restarts
  await setBotSetting("recon_status", status);
  await setBotSetting("recon_activity", activity ?? "");

  const statusLabel = STATUS_LABELS[status] ?? status;
  const activityLine = activity ? `\nActivity: *${activity}*` : "";

  await interaction.reply({
    content: `**[SIGMA-7 // RECON STATUS UPDATED — PERSISTED]**\nStatus: **${statusLabel}**${activityLine}\n*This status will be restored after every restart.*`,
    ephemeral: true,
  });
}
