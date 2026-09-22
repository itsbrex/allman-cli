import { join } from "node:path";
import { resolveStorePath, Store } from "../store/index.js";
import {
  readJson,
  withWorkspaceLock,
  workspaceRoot,
  writePrivate,
} from "../store/private-workspace.js";
import {
  filterContacts,
  type RelationshipFilters,
  type RelationshipSettings,
  relationshipSnapshot,
} from "../store/relationships.js";
import { validateLocalName } from "../utils/local-name.js";
import * as output from "../utils/output.js";

export function selectedFilters(opts: RelationshipFilters): RelationshipFilters {
  return Object.fromEntries(
    ["tag", "anyTag", "allTags", "withoutTags", "company", "geo", "channel", "account"]
      .filter((key) => opts[key as keyof RelationshipFilters] !== undefined)
      .map((key) => [key, opts[key as keyof RelationshipFilters]])
  );
}
export async function groupsCommand(
  action: string,
  name: string | undefined,
  opts: RelationshipFilters & { store?: string; json?: boolean }
) {
  const store = new Store({ path: resolveStorePath(opts.store) }),
    root = workspaceRoot(store.root);
  if (action === "list" || action === "show") {
    const snapshot = await relationshipSnapshot(store, root);
    if (action === "list") return output.printData(snapshot.lists);
    validateLocalName(name);
    if (!Object.hasOwn(snapshot.lists, name)) throw new Error("Unknown group");
    return output.printData(filterContacts(snapshot, snapshot.lists[name] ?? {}));
  }
  if (action !== "set" && action !== "delete")
    throw new Error("Use group set, list, show or delete");
  validateLocalName(name);
  await withWorkspaceLock(root, async () => {
    const path = join(root, "relationship-settings.json");
    const settings = await readJson<RelationshipSettings>(path, { threads: {}, lists: {} });
    if (action === "set") settings.lists[name] = selectedFilters(opts);
    else {
      if (!Object.hasOwn(settings.lists, name)) throw new Error("Unknown group");
      delete settings.lists[name];
    }
    await writePrivate(path, settings);
  });
  output.printData({ action, name });
}
