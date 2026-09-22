import { resolveStorePath, Store } from "../store/index.js";
import { workspaceRoot } from "../store/private-workspace.js";
import { relationshipSnapshot } from "../store/relationships.js";
import * as output from "../utils/output.js";
export async function rankCommand(
  target: string | undefined,
  opts: { store?: string; json?: boolean }
) {
  const store = new Store({ path: resolveStorePath(opts.store) });
  const snapshot = await relationshipSnapshot(store, workspaceRoot(store.root));
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
      .sort((a, b) => (b.rank?.score ?? 0) - (a.rank?.score ?? 0) || a.id.localeCompare(b.id))
      .map((c) => ({ contactId: c.id, name: c.name, rank: c.rank }))
  );
}
