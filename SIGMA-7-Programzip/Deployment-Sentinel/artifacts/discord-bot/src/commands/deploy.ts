import { Message, Client } from "discord.js";
import {
  getPendingPoll,
  getActiveDeployment,
  deletePendingPoll,
} from "../lib/state.js";
import { hasDeploymentPermission } from "../lib/permissions.js";
import { resolvePoll } from "./deploymentStart.js";

export async function handleDeploy(
  message: Message,
  _args: string[],
  client: Client
): Promise<void> {
  if (!message.guild || !message.member) return;

  const permitted = await hasDeploymentPermission(message.member);
  if (!permitted) {
    await message.reply(
      "🔒 **Access Denied.** You do not have authorization to force a deployment."
    );
    return;
  }

  if (getActiveDeployment(message.guild.id)) {
    await message.reply(
      "⚠️ A deployment is already active. Use `!deploymentend` to conclude it first."
    );
    return;
  }

  const pending = getPendingPoll(message.guild.id);
  if (!pending) {
    await message.reply(
      "⚠️ No active deployment poll to force-start. Use `!deploymentstart [Location]` to open a poll first."
    );
    return;
  }

  clearTimeout(pending.timeoutHandle);
  deletePendingPoll(message.guild.id);

  await message.reply("⚡ **Forcing deployment — skipping poll timer.**");

  await resolvePoll(
    client,
    pending.guildId,
    pending.channelId,
    pending.pollMessageId,
    pending.location,
    pending.startedByUserId,
    pending.startedByUsername,
    pending.pollStartedAt
  );
}
