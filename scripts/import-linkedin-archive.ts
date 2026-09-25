/** Usage: ALLMAN_PROFILE=jp bun scripts/import-linkedin-archive.ts bundle.json RUN_ID [--apply] */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeLinkedInUrl } from "../src/attio/people.js";
import { cachedSalesnavPlan, type SalesnavResolutions } from "../src/attio/salesnav-import.js";
import type { IdentityCache } from "../src/attio/salesnav-list.js";
import { readTargetPlan, storedConnections, targetContext } from "../src/commands/enrich-list.js";
import {
  type ArchiveChange,
  applyArchiveChanges,
  readOptionalFile,
} from "../src/imports/archive-journal.js";
import {
  type ArchiveBundle,
  archiveEvents,
  archiveFacts,
  archiveMappings,
  type LinkedInArchive,
  mergeLinkedInArchive,
  missingArchiveFacts,
} from "../src/imports/linkedin-archive.js";
import { applyFieldObservations, meaningful } from "../src/store/observations.js";
import { readJson, withWorkspaceLock, workspaceRoot } from "../src/store/private-workspace.js";

const [input, runId, mode] = process.argv.slice(2);
if (!input || !runId || (mode && mode !== "--apply"))
  throw new Error("Expected bundle.json RUN_ID [--apply]");
const { store, account, root: targetRoot } = await targetContext({});
const root = workspaceRoot(store.root);
const bundle = JSON.parse(await readFile(input, "utf8")) as ArchiveBundle;
const auth = await store.accounts.readAuth(account);
if (!auth) throw new Error("Selected account is missing local identity");
if (
  bundle.version !== 1 ||
  bundle.account !== account ||
  normalizeLinkedInUrl(bundle.ownerProfileUrl) !==
    normalizeLinkedInUrl(auth.profileUrl ?? `https://www.linkedin.com/in/${auth.profileSlug}`)
)
  throw new Error("Archive owner does not match selected account");
for (const source of bundle.sources) {
  if (
    !Number.isFinite(Date.parse(source.exportedAt)) ||
    createHash("sha256")
      .update(await readFile(source.rawPath))
      .digest("hex") !== source.id
  )
    throw new Error("Invalid archive source date or checksum");
}

await withWorkspaceLock(root, () =>
  withWorkspaceLock(targetRoot, async () => {
    const rows = await storedConnections(store, account);
    const plan = await readTargetPlan(targetRoot, runId, account, store.root);
    const cachePath = join(targetRoot, "salesnav-identities.json");
    const cache = await readJson<IdentityCache>(cachePath, { version: 1, account, mappings: {} });
    const resolved = await readJson<SalesnavResolutions>(
      join(targetRoot, runId, "identities.json"),
      { version: 1, account, runId, identities: {} }
    );
    const current = cachedSalesnavPlan(plan, rows, cache, resolved);
    const mappings = archiveMappings(
      bundle.sources,
      rows,
      cache,
      new Set(
        current.matches.filter((m) => m.outcome === "missing-identity").map((m) => m.personId)
      )
    );
    const changes: ArchiveChange[] = [];
    const nextCache = { ...cache, mappings: { ...cache.mappings } };
    for (const mapping of mappings) nextCache.mappings[mapping.flagshipId] = mapping.salesnavId;
    if (mappings.length)
      changes.push({
        stage: "identities",
        path: cachePath,
        before: await readOptionalFile(cachePath),
        after: nextCache,
      });

    const { facts, emails, ...sourceCounts } = archiveFacts(bundle.sources, rows);
    const fields: Record<string, number> = {};
    let peopleFilled = 0,
      preservedFields = 0;
    const people = store.peopleFor(account);
    for (const row of rows) {
      const candidates = facts.get(row.flagshipId);
      if (!candidates) continue;
      const path = join(store.root, account, "people", `${row.flagshipId}.json`);
      const before = await readOptionalFile(path);
      const mirrorPath = join(store.root, account, "connections", `${row.flagshipId}.json`);
      const mirrorBefore = await readOptionalFile(mirrorPath);
      if (!mirrorBefore) throw new Error("Connection disappeared during import");
      const person = await people.readPerson(row.flagshipId);
      if (!person) continue;
      if (
        (await readOptionalFile(path)) !== before ||
        (await readOptionalFile(mirrorPath)) !== mirrorBefore
      )
        throw new Error("Person changed during archive planning; retry when other writers finish");
      const observations = missingArchiveFacts(person, candidates);
      preservedFields += Object.keys(candidates).length - Object.keys(observations).length;
      const previous =
        before === null
          ? {
              flagshipId: row.flagshipId,
              memberUrn: row.memberUrn,
              publicIdentifier: person.publicIdentifier,
              firstSeenAt: person.firstSeenAt,
              lastSeenAt: person.lastSeenAt,
            }
          : JSON.parse(before);
      const applied = applyFieldObservations(
        previous,
        previous.provenance ?? {},
        observations,
        new Set(Object.keys(observations))
      );
      if (Object.keys(observations).length) {
        peopleFilled++;
        changes.push({
          stage: "fields",
          path,
          before,
          after: { ...applied.facts, provenance: applied.provenance },
        });
      }
      const mirror = JSON.parse(mirrorBefore);
      let mirrorChanged = false;
      for (const field of Object.keys(observations)) {
        fields[field] = (fields[field] ?? 0) + 1;
      }
      // Repair a mirror if a prior run stopped after its person record was saved.
      for (const field of Object.keys(candidates)) {
        const provenance = applied.provenance[field];
        const fact = applied.facts[field];
        if (provenance?.source !== "linkedin/archive" || !meaningful(fact)) continue;
        if (!meaningful(mirror[field]) && !mirror.provenance?.[field]) {
          mirror[field] = fact;
          mirror.provenance ??= {};
          mirror.provenance[field] = provenance;
          mirrorChanged = true;
        }
      }
      if (mirrorChanged)
        changes.push({ stage: "fields", path: mirrorPath, before: mirrorBefore, after: mirror });
    }
    const parsed = archiveEvents(bundle);
    const historyPath = join(root, "linkedin-archives", `${account}.json`);
    const historyBefore = await readOptionalFile(historyPath);
    const previous: LinkedInArchive =
      historyBefore === null
        ? { version: 1, account, sources: [], events: [], emails: [] }
        : JSON.parse(historyBefore);
    const history = mergeLinkedInArchive(previous, {
      version: 1,
      account,
      sources: bundle.sources.map(({ rows: _rows, ...s }) => s),
      events: parsed.events,
      emails,
    });
    if (JSON.stringify(history) !== JSON.stringify(previous))
      changes.push({ stage: "history", path: historyPath, before: historyBefore, after: history });
    const updated = cachedSalesnavPlan(plan, rows, nextCache, resolved);
    const report = {
      account,
      input,
      runId,
      mode: mode ? "apply" : "preview",
      mappingsAdded: mappings.length,
      matchedBefore: current.targets.length,
      matchedAfter: updated.targets.length,
      unresolvedAfter: updated.matches.filter((m) => m.outcome === "missing-identity").length,
      peopleFilled,
      fields,
      preservedFields,
      ...sourceCounts,
      messages: history.events.filter((e) => e.kind === "message").length,
      drafts: history.events.filter((e) => e.draft).length,
      invitations: history.events.filter((e) => e.kind === "invitation").length,
      newEvents: history.events.length - previous.events.length,
      invalidDates: parsed.invalidDates,
      historicalEmailPeople: new Set(history.emails.map((e) => e.flagshipId)).size,
      historicalEmails: new Set(history.emails.map((e) => e.email)).size,
      filesChanged: changes.length,
      providerRequests: 0,
    };
    const backup = mode
      ? await applyArchiveChanges(root, changes, { ...report, mappingEvidence: mappings })
      : null;
    console.log(JSON.stringify({ ...report, backup }, null, 2));
  })
);
