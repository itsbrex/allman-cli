import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  browserEnvDefaults,
  mergeBrowserConfig,
  readBrowserConfig,
} from "../linkedin/auth/browser-config.js";
import { readNeoConnections } from "../linkedin/auth/neo-mcp.js";
import { resolveStorePath, Store } from "../store/index.js";
import * as output from "../utils/output.js";
import type { ConnectionsOptions } from "./connections.js";

/** A bounded browser import; no login/cookie export and no outbound mutations. */
export async function connectionsNeoCommand(opts: ConnectionsOptions): Promise<void> {
  if (
    opts.enrich ||
    opts.deep ||
    opts.salesnav ||
    opts.csv ||
    opts.geo?.length ||
    opts.geoGranularity
  )
    throw new Error(
      "Neo MCP batches do not support --enrich, --deep, --salesnav, --csv, or --geo. Use separate commands for those workflows."
    );
  const storePath = resolveStorePath(opts.store);
  const store = new Store({ path: storePath });
  const account = opts.account || process.env.ALLMAN_ACCOUNT;
  const existing = await store.accounts.list();
  const expectedProfileId =
    account || existing.length ? await store.accounts.getDefault(account) : undefined;
  const config = mergeBrowserConfig(readBrowserConfig(), browserEnvDefaults(), {
    shieldPath: opts.shield,
  });
  const start = opts.start ?? 0;
  const result = await readNeoConnections({
    endpoint: opts.browserosMcp ?? "http://127.0.0.1:9010/mcp",
    shieldPath: config.shieldPath,
    count: opts.limit ?? 25,
    start,
    expectedProfileId,
  });
  const { owner, page } = result;
  if (
    !/^ACo[A-Za-z0-9_-]+$/.test(owner.profileId) ||
    (expectedProfileId && expectedProfileId !== owner.profileId)
  )
    throw new Error("LinkedIn browser account mismatch or invalid identity.");
  const records = page.records.map((record) => {
    const id = /^urn:li:fsd_profile:(ACo[A-Za-z0-9_-]+)$/.exec(record.memberUrn)?.[1];
    if (!id) throw new Error("LinkedIn returned an invalid connection identity.");
    return { record, id };
  });
  if (opts.json) {
    for (const { record, id } of records)
      output.emitEvent({
        memberId: id,
        memberUrn: record.memberUrn,
        publicIdentifier: record.publicIdentifier,
        firstName: record.firstName,
        lastName: record.lastName,
        connectedAtMs: record.connectedAt,
        ...(opts.includeHeadline ? { headline: record.headline } : {}),
      });
  }
  if (!opts.noStore) {
    await mkdir(storePath, { recursive: true, mode: 0o700 });
    await store.init();
    if (!(await store.accounts.exists(owner.profileId))) {
      await store.accounts.writeAuth(owner.profileId, {
        urn: `urn:li:fsd_profile:${owner.profileId}`,
        profileSlug: owner.profileSlug,
        name: owner.name,
        headline: null,
        profileUrl: owner.profileSlug ? `https://www.linkedin.com/in/${owner.profileSlug}/` : null,
        imageUrl: null,
        userType: null,
        networkSize: null,
        status: "unauthenticated",
        lastSyncAt: null,
      });
      await chmod(join(storePath, owner.profileId, "AUTH.json"), 0o600);
      if (owner.profileSlug) await store.accounts.createAlias(owner.profileSlug, owner.profileId);
    }
    const cstore = store.connectionsFor(owner.profileId);
    const now = new Date().toISOString();
    for (const { record, id } of records) {
      await cstore.upsertConnection(
        {
          memberUrn: record.memberUrn,
          flagshipId: id,
          publicIdentifier: record.publicIdentifier,
          firstName: record.firstName,
          lastName: record.lastName,
          headline: opts.includeHeadline ? record.headline : null,
          connectedAt:
            record.connectedAt === null ? null : new Date(record.connectedAt).toISOString(),
          profilePictureUrl: record.profilePictureUrl,
          memorialized: record.memorialized,
          source: "connections",
        },
        now
      );
      await chmod(join(storePath, owner.profileId, "connections", `${id}.json`), 0o600);
    }
    store.git.scheduleCommit(
      `✨ feat(store): import ${records.length} LinkedIn connections through Neo MCP`
    );
    await store.git.flush();
  }
  output.info(
    `Neo MCP: ${records.length} connections; ${page.isLastPage ? "end of results" : `partial batch, next --start ${start + records.length}`}. Credentials remain in browser.`
  );
  if (!opts.json)
    output.printData({
      imported: opts.noStore ? 0 : records.length,
      fetched: records.length,
      complete: start === 0 && page.isLastPage,
      endOfResults: page.isLastPage,
      nextStart: page.isLastPage ? null : start + records.length,
      credentialsStored: false,
      remoteWrites: 0,
    });
}
