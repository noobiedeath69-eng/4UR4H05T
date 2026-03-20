export interface PendingPoll {
  guildId: string;
  channelId: string;
  pollMessageId: string;
  location: string;
  startedByUserId: string;
  startedByUsername: string;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface ActiveDeployment {
  id: number;
  guildId: string;
  channelId: string;
  pollMessageId: string;
  timerMessageId: string;
  threadId: string | null;
  location: string;
  type: string;
  startedAt: Date;
  startedByUserId: string;
  startedByUsername: string;
  intervalHandle: ReturnType<typeof setInterval>;
}

const pendingPolls = new Map<string, PendingPoll>();
const activeDeployments = new Map<string, ActiveDeployment>();
const conversationHistories = new Map<string, Array<{ role: "user" | "assistant" | "system"; content: string }>>();

export function setPendingPoll(guildId: string, poll: PendingPoll): void {
  pendingPolls.set(guildId, poll);
}

export function getPendingPoll(guildId: string): PendingPoll | undefined {
  return pendingPolls.get(guildId);
}

export function deletePendingPoll(guildId: string): void {
  pendingPolls.delete(guildId);
}

export function setActiveDeployment(guildId: string, dep: ActiveDeployment): void {
  activeDeployments.set(guildId, dep);
}

export function getActiveDeployment(guildId: string): ActiveDeployment | undefined {
  return activeDeployments.get(guildId);
}

export function deleteActiveDeployment(guildId: string): void {
  activeDeployments.delete(guildId);
}

export function getConversationHistory(channelId: string): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  if (!conversationHistories.has(channelId)) {
    conversationHistories.set(channelId, []);
  }
  return conversationHistories.get(channelId)!;
}

export function addToConversationHistory(
  channelId: string,
  role: "user" | "assistant",
  content: string
): void {
  const history = getConversationHistory(channelId);
  history.push({ role, content });
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
}

export function clearConversationHistory(channelId: string): void {
  conversationHistories.set(channelId, []);
}
