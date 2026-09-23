#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startActivityServer } from "../src/activity/server.ts";
import { activityContext } from "../src/commands/activity.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicOrigin = process.env.PORTLESS_URL;
if (publicOrigin !== "https://allman-activity.localhost")
  throw new Error("Start with bun run activity:serve (the local Plans/Portless route)");
const port = Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error("Portless did not provide a valid PORT");
const context = await activityContext({});
const server = await startActivityServer({
  ...context,
  port,
  publicOrigin,
  artifact: {
    html: await readFile(join(root, "apps/activity.html"), "utf8"),
    ogImage: await readFile(join(root, "apps/activity-og.png")),
  },
});
console.log(`Live activity: ${server.url} (local observer; no LinkedIn connection)`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
