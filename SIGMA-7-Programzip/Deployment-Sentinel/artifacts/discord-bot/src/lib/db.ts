import { db, deploymentsTable, whitelistedUsersTable, whitelistedRolesTable, sentientChannelsTable, registeredPlacesTable, conversationHistoryTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { NewDeployment } from "@workspace/db";

export async function createDeploymentRecord(data: NewDeployment) {
  const [record] = await db.insert(deploymentsTable).values(data).returning();
  return record;
}

export async function getActiveDeploymentRecord(guildId: string) {
  const [record] = await db
    .select()
    .from(deploymentsTable)
    .where(and(eq(deploymentsTable.guildId, guildId), eq(deploymentsTable.active, true)))
    .limit(1);
  return record ?? null;
}

export async function updateDeploymentPhase(
  id: number,
  phase: string,
  extra: { type?: string; startedAt?: Date; timerMessageId?: string; threadId?: string } = {}
) {
  await db
    .update(deploymentsTable)
    .set({ phase, ...extra })
    .where(eq(deploymentsTable.id, id));
}

export async function endDeploymentRecord(id: number) {
  await db
    .update(deploymentsTable)
    .set({ active: false, phase: "ended", endedAt: new Date() })
    .where(eq(deploymentsTable.id, id));
}

export async function isUserWhitelisted(userId: string): Promise<boolean> {
  const [record] = await db
    .select()
    .from(whitelistedUsersTable)
    .where(eq(whitelistedUsersTable.userId, userId))
    .limit(1);
  return !!record;
}

export async function addWhitelistedUser(userId: string, username: string) {
  await db
    .insert(whitelistedUsersTable)
    .values({ userId, username })
    .onConflictDoNothing();
}

export async function isRoleWhitelisted(roleId: string): Promise<boolean> {
  const [record] = await db
    .select()
    .from(whitelistedRolesTable)
    .where(eq(whitelistedRolesTable.roleId, roleId))
    .limit(1);
  return !!record;
}

export async function addWhitelistedRole(roleId: string, roleName: string) {
  await db
    .insert(whitelistedRolesTable)
    .values({ roleId, roleName })
    .onConflictDoNothing();
}

export async function addPlace(name: string) {
  await db.insert(registeredPlacesTable).values({ name }).onConflictDoNothing();
}

export async function getPlaces() {
  return db.select().from(registeredPlacesTable).orderBy(registeredPlacesTable.name);
}

export async function getSentientChannel(guildId: string) {
  const [record] = await db
    .select()
    .from(sentientChannelsTable)
    .where(eq(sentientChannelsTable.guildId, guildId))
    .limit(1);
  return record ?? null;
}

export async function setSentientChannel(guildId: string, channelId: string, channelName: string) {
  await db
    .insert(sentientChannelsTable)
    .values({ guildId, channelId, channelName })
    .onConflictDoUpdate({
      target: sentientChannelsTable.channelId,
      set: { channelId, channelName, guildId },
    });

  const existing = await db
    .select()
    .from(sentientChannelsTable)
    .where(and(eq(sentientChannelsTable.guildId, guildId)));

  for (const row of existing) {
    if (row.channelId !== channelId) {
      await db.delete(sentientChannelsTable).where(eq(sentientChannelsTable.id, row.id));
    }
  }
}
