import { activityContext } from "../commands/activity.js";
import { sessionCommand } from "../commands/session.js";
import { readSessionRegistry } from "../linkedin/session-control.js";

export const activityProfileControls = {
  read() {
    const registry = readSessionRegistry();
    return {
      active: registry?.active ?? null,
      profiles: registry?.profiles.map(({ name }) => ({ name })) ?? [],
    };
  },
  async activate(name: string) {
    await sessionCommand("activate", name, {});
  },
};

/** Resolve the registry on every snapshot. Never mutate process-wide profile settings. */
export async function activeActivityContext() {
  const registry = readSessionRegistry();
  const profile = registry?.profiles.find((p) => p.name === registry.active);
  if (!profile) return null;
  const selection = JSON.stringify(profile);
  const env: NodeJS.ProcessEnv = { ...process.env, ALLMAN_PROFILE: profile.name };
  delete env.ALLMAN_RELATIONSHIP_STORE;
  const context = await activityContext({ store: profile.store, account: profile.account }, env);
  const current = readSessionRegistry();
  if (
    current?.active !== profile.name ||
    JSON.stringify(current.profiles.find((p) => p.name === current.active)) !== selection
  )
    return null;
  return { ...context, profile: profile.name };
}
