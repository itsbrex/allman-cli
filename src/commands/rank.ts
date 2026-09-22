import { writeRankOverride } from "../relationships/rank-overrides.js";
import { resolveStorePath, Store } from "../store/index.js";
import { withWorkspaceLock, workspaceRoot } from "../store/private-workspace.js";
import { relationshipSnapshot } from "../store/relationships.js";
import * as output from "../utils/output.js";
export async function rankCommand(
  target: string | undefined,
  opts: {
    store?: string;
    json?: boolean;
    set?: number;
    clear?: boolean;
    pin?: boolean;
    unpin?: boolean;
    reason?: string;
  }
) {
  const store = new Store({ path: resolveStorePath(opts.store) });
  const root = workspaceRoot(store.root);
  const mutating = opts.set !== undefined || opts.clear || opts.pin || opts.unpin;
  if (mutating) {
    if (!target) throw new Error("Rank changes require a contact id");
    await withWorkspaceLock(root, async () => {
      const snapshot = await relationshipSnapshot(store, root);
      const contact = snapshot.contacts.find((c) => c.id === target);
      if (!contact) throw new Error("Contact not found; use a contact id");
      await writeRankOverride(root, contact.id, { ...opts, score: opts.set });
    });
  }
  const snapshot = await relationshipSnapshot(store, root);
  const contacts = snapshot.contacts.filter(
    (c) =>
      !target ||
      c.id === target ||
      c.emails.includes(target) ||
      c.linkedin.some((l) => l.flagshipId === target)
  );
  if (target && contacts.length !== 1)
    throw new Error("Contact not found or ambiguous; use a contact id");
  output.printData(
    contacts
      .sort(
        (a, b) =>
          Number(b.rank?.pinned ?? false) - Number(a.rank?.pinned ?? false) ||
          (b.rank?.score ?? 0) - (a.rank?.score ?? 0) ||
          a.id.localeCompare(b.id)
      )
      .map((c) => ({ contactId: c.id, name: c.name, rank: c.rank }))
  );
}
