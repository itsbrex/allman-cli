import { contactId } from "../mail/store.js";
import type { RelationshipContact } from "../store/relationships.js";
import type { AttioCache, AttioPerson } from "./people.js";
export interface AttioAssociation {
  status:
    | "unchecked"
    | "matched"
    | "not-found"
    | "ambiguous"
    | "unavailable"
    | "stale"
    | "conflict"
    | "unlinked";
  checkedAt?: string;
  recordId?: string;
  workspaceId?: string;
  webUrl?: string;
  emails?: string[];
  reason?: string;
}
/** Reversible view join. No CRM edits and no inferred changes to persisted identities. */
export function correlateAttio(
  contacts: Map<string, RelationshipContact>,
  cache: AttioCache,
  now: number,
  blocked: string[] = []
) {
  const candidates = new Map<string, AttioPerson>();
  for (const c of contacts.values()) {
    const urls = c.linkedinUrls ?? [];
    if (!urls.length) continue;
    if (c.linkedin.some((l) => blocked.includes(`${l.account}/${l.flagshipId}`))) {
      c.attio = {
        status: "unlinked",
        reason: "Local unlink overrides automatic Attio correlation",
      };
      continue;
    }
    const lookups = urls.map((url) => cache.lookups[url]);
    const missing = lookups.some((l) => !l);
    if (missing) {
      c.attio = { status: "unchecked" };
      continue;
    }
    const found = lookups.filter((l) => !!l);
    const checkedAt = found.map((l) => l.checkedAt).sort()[0];
    if (
      found.some(
        (l) => now - Date.parse(l.checkedAt) >= 86400000 || Date.parse(l.checkedAt) > now + 60000
      )
    ) {
      c.attio = {
        status: "stale",
        checkedAt,
        reason: "Refresh Attio lookup before joining mail identities",
      };
      continue;
    }
    const incomplete = found.find((l) => !l.complete || l.status === "unavailable");
    if (incomplete) {
      c.attio = { status: "unavailable", checkedAt };
      continue;
    }
    const people = [
      ...new Map(
        found.flatMap((l) => l.matches).map((p) => [`${p.workspaceId}/${p.recordId}`, p])
      ).values(),
    ];
    if (people.length !== 1 || found.some((l) => l.status !== "matched")) {
      c.attio = {
        status:
          people.length > 1 || found.some((l) => l.status === "ambiguous")
            ? "ambiguous"
            : "not-found",
        checkedAt,
      };
      continue;
    }
    const person = people[0];
    if (!person) continue;
    candidates.set(c.id, person);
    c.attio = {
      status: "matched",
      checkedAt,
      recordId: person.recordId,
      workspaceId: person.workspaceId,
      webUrl: person.webUrl,
      emails: person.emails,
    };
  }
  const claims = new Map<string, Set<string>>();
  for (const [id, p] of candidates)
    for (const email of p.emails) {
      const owners = claims.get(email) ?? new Set<string>();
      owners.add(id);
      claims.set(email, owners);
    }
  const redirects = new Map<string, string>();
  for (const [id, p] of candidates) {
    const c = contacts.get(id);
    if (!c) continue;
    const conflict = p.emails.some((email) => {
      const other = contacts.get(contactId(`email:${email}`));
      return (
        (claims.get(email)?.size ?? 0) > 1 ||
        (other &&
          other.id !== id &&
          other.linkedin.some(
            (l) => !c.linkedin.some((x) => x.account === l.account && x.flagshipId === l.flagshipId)
          ))
      );
    });
    if (conflict) {
      c.attio = {
        ...c.attio,
        status: "conflict",
        reason: "Email identity has another LinkedIn or Attio owner; review before linking",
      };
      continue;
    }
    for (const email of p.emails) {
      const emailId = contactId(`email:${email}`),
        other = contacts.get(emailId);
      redirects.set(emailId, id);
      if (other && emailId !== id) c.tags = [...new Set([...c.tags, ...other.tags])];
    }
  }
  for (const [from, to] of redirects) if (from !== to) contacts.delete(from);
  return redirects;
}
