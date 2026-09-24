#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createReviewServer, latestReviewFile } from "../src/attio/review-server.ts";
import { targetContext } from "../src/commands/enrich-list.ts";

const publicOrigin = process.env.PORTLESS_URL;
if (publicOrigin !== "https://allman-enrichment.localhost")
  throw new Error("Start with bun run enrichment:serve (the local Plans/Portless route)");
const port = Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid Portless PORT");

try {
  const explicit = process.env.ALLMAN_REVIEW_HTML;
  const file = explicit
    ? resolve(explicit)
    : await latestReviewFile((await targetContext({})).root, "review.html");
  await readFile(file).catch(() => {
    throw new Error(
      `Review file does not exist or cannot be read: ${file}\n/absolute/private/review.html was a placeholder. Unset ALLMAN_REVIEW_HTML to select this account's newest saved review, or set it to a real file. Run bun run enrichment:build first if needed.`
    );
  });
  const server = createReviewServer(file, publicOrigin, port);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Review: ${file}\n${publicOrigin}/apps/target-enrichment.html`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => server.close(() => process.exit(0)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
