import { readFile } from "node:fs/promises";
import {
  type AttioLookup,
  AttioPeopleSource,
  exactAttioLookup,
  normalizeLinkedInUrl,
  readAttioCache,
  storeAttioLookups,
} from "../attio/people.js";
import { resolveStorePath, Store } from "../store/index.js";
import { withWorkspaceLock, workspaceRoot } from "../store/private-workspace.js";
import { saveSnapshot } from "../store/relationships.js";
import * as output from "../utils/output.js";
export async function attioCommand(
  action: string,
  target: string | undefined,
  opts: { store?: string; json?: boolean }
) {
  const store = new Store({ path: resolveStorePath(opts.store) }),
    root = workspaceRoot(store.root);
  if (action === "status") {
    output.printData(await readAttioCache(root));
    return;
  }
  const urls = new Set<string>();
  if (target && action === "lookup") {
    const url = normalizeLinkedInUrl(target);
    if (!url) throw new Error("Use a public linkedin.com/in/ profile URL");
    urls.add(url);
  } else if (["candidates", "sync"].includes(action)) {
    for (const account of await store.accounts.list()) {
      const people = store.peopleFor(account);
      for (const id of await people.listPersonIds()) {
        const person = await people.readPerson(id);
        if (person?.publicIdentifier) {
          const url = normalizeLinkedInUrl(
            `https://www.linkedin.com/in/${person.publicIdentifier}`
          );
          if (url) urls.add(url);
        }
      }
    }
    if (action === "candidates") {
      output.printData([...urls]);
      return;
    }
  } else if (action !== "import")
    throw new Error("Use attio candidates, lookup <url>, sync, import <file>, or status");
  if (action === "import") {
    if (!target) throw new Error("Supply an Attio MCP lookup export file");
    const envelope = JSON.parse(await readFile(target, "utf8")) as {
      lookups?: { linkedinUrl: string; checkedAt: string; complete: boolean; records: unknown[] }[];
    };
    if (
      !Array.isArray(envelope.lookups) ||
      envelope.lookups.some(
        (l) =>
          !Array.isArray(l.records) ||
          typeof l.complete !== "boolean" ||
          typeof l.checkedAt !== "string"
      )
    )
      throw new Error("Invalid Attio MCP lookup export");
    const lookups = envelope.lookups.map((l) =>
      exactAttioLookup(l.linkedinUrl, l.records, l.complete, l.checkedAt, "attio-mcp")
    );
    await withWorkspaceLock(root, async () => {
      await storeAttioLookups(root, lookups);
      await saveSnapshot(store, root);
    });
    output.printData({ imported: lookups.length, remoteWrites: 0 });
    return;
  }
  if (!urls.size) {
    output.printData({
      lookedUp: 0,
      reason: "No stored LinkedIn public profile URLs",
      remoteWrites: 0,
    });
    return;
  }
  const token = process.env.ATTIO_API_KEY ?? process.env.ATTIO_ACCESS_TOKEN;
  if (!token)
    throw new Error(
      "Attio credentials are not configured for the CLI. Use the connected Attio MCP to query candidates and import its lookup export, or supply ATTIO_API_KEY through your credential manager."
    );
  const source = new AttioPeopleSource(token);
  const lookups: AttioLookup[] = [];
  for (const url of urls) lookups.push(await source.lookup(url));
  await withWorkspaceLock(root, async () => {
    await storeAttioLookups(root, lookups);
    await saveSnapshot(store, root);
  });
  output.printData(lookups);
}
