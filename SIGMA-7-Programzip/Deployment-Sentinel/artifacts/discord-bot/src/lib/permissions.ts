import { GuildMember, PermissionFlagsBits } from "discord.js";
import { isUserWhitelisted } from "./db.js";

export function isServerAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

export async function hasDeploymentPermission(member: GuildMember): Promise<boolean> {
  if (isServerAdmin(member)) return true;
  return isUserWhitelisted(member.user.id);
}

export function isOwner(userId: string): boolean {
  const ownerId = process.env["OWNER_DISCORD_ID"];
  if (!ownerId) return false;
  return userId === ownerId;
}
