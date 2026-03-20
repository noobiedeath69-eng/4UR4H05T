import { GuildMember, PermissionFlagsBits } from "discord.js";
import { isUserWhitelisted, isRoleWhitelisted } from "./db.js";

export function isServerAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

export async function hasDeploymentPermission(member: GuildMember): Promise<boolean> {
  if (isServerAdmin(member)) return true;
  if (await isUserWhitelisted(member.user.id)) return true;

  const roleIds = [...member.roles.cache.keys()];
  for (const roleId of roleIds) {
    if (await isRoleWhitelisted(roleId)) return true;
  }

  return false;
}

export function isOwner(userId: string): boolean {
  const ownerId = process.env["OWNER_DISCORD_ID"];
  if (!ownerId) return false;
  return userId === ownerId;
}
