import { Message } from "discord.js";
import { getActiveDeployment, setActiveDeployment } from "./state.js";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function buildStartMessage(
  location: string,
  type: string,
  startedByUserId: string,
  checkCount: number,
  startedAt: Date
): string {
  const elapsed = Date.now() - startedAt.getTime();
  const duration = formatDuration(elapsed);
  const typeLabel = type.toUpperCase();
  return [
    `📡 **Lambda-13 is initiating a ${typeLabel}.**`,
    `Per protocol, authorized Foundation allies are permitted to operate alongside our forces for this mission. Once you have joined as RRT, ping the designated officer in your lore to be morphed.`,
    ``,
    `**📍 Location:** ${location}`,
    `**👤 Commanding Officer:** <@${startedByUserId}>`,
    `**✅ Units Confirmed:** ${checkCount}`,
    `**⏳ Elapsed:** \`${duration}\``,
    `\`-# Timer updates every 60 seconds.\``,
  ].join("\n");
}

export async function startLiveTimer(
  timerMessage: Message,
  guildId: string
): Promise<void> {
  const deployment = getActiveDeployment(guildId);
  if (!deployment) return;

  deployment.timerMessageId = timerMessage.id;
  setActiveDeployment(guildId, deployment);

  const handle = setInterval(async () => {
    const current = getActiveDeployment(guildId);
    if (!current) {
      clearInterval(handle);
      return;
    }

    const content = buildStartMessage(
      current.location,
      current.type,
      current.startedByUserId,
      0,
      current.startedAt
    );

    await timerMessage.edit(content).catch(() => {});
  }, 60_000);

  deployment.intervalHandle = handle;
  setActiveDeployment(guildId, deployment);
}

export function stopLiveTimer(guildId: string): void {
  const deployment = getActiveDeployment(guildId);
  if (!deployment) return;
  clearInterval(deployment.intervalHandle);
}

export function calculatePoints(startedAt: Date, endedAt: Date): number {
  const totalMs = endedAt.getTime() - startedAt.getTime();
  const totalMinutes = Math.floor(totalMs / 60_000);
  const thirtyMinBlocks = Math.floor(totalMinutes / 30);
  return thirtyMinBlocks * 5;
}

export { formatDuration };
