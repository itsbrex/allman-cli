import { join } from "node:path";
import { MailStore } from "../mail/store.js";
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
  saveSnapshot,
  selectContacts,
} from "../store/relationships.js";
import { validateLocalName } from "../utils/local-name.js";
import * as output from "../utils/output.js";
import { selectedFilters } from "./groups.js";
export interface RelationshipOptions extends RelationshipFilters {
  store?: string;
  json?: boolean;
  list?: string;
  flagship?: string;
  days?: number;
}
export async function relationshipsCommand(
  action: string,
  target: string | undefined,
  values: string[],
  opts: RelationshipOptions
) {
  const store = new Store({ path: resolveStorePath(opts.store) }),
    root = workspaceRoot(store.root),
    mail = new MailStore(root);
  const readActions = ["list", "show", "followups", "timeline", "status", "review"];
  if (readActions.includes(action)) {
    const snapshot = await relationshipSnapshot(store, root);
    if (action === "status") {
      output.printData({ workspace: root, coverage: snapshot.coverage });
      return;
    }
    if (action === "review") {
      output.printData({
        companyMergeCandidates: snapshot.mergeReview,
        attio: snapshot.contacts.filter((c) => c.attio && c.attio.status !== "matched"),
        unlinkedEmailContacts: snapshot.contacts.filter(
          (c) => c.emails.length && !c.linkedin.length
        ),
      });
      return;
    }
    const contacts = selectContacts(snapshot, opts);
    if (action === "list") {
      output.printData(contacts);
      return;
    }
    if (action === "followups") {
      const ids = new Set(contacts.map((c) => c.id));
      output.printData(snapshot.followups.filter((f) => ids.has(f.contactId)));
      return;
    }
    if (!target) throw new Error("Supply a contact id");
    const contact = contacts.find(
      (c) =>
        c.id === target ||
        c.emails.includes(target) ||
        (c.attio?.status === "matched" && c.attio.emails?.includes(target))
    );
    if (!contact) throw new Error("Contact not found");
    const timeline = snapshot.timeline.filter((e) => e.contactIds.includes(contact.id));
    output.printData(
      action === "timeline" ? timeline : { contact, timeline, coverage: snapshot.coverage }
    );
    return;
  }
  await withWorkspaceLock(root, async () => {
    if (action === "refresh") {
      const snapshot = await saveSnapshot(store, root);
      output.printData({
        contacts: snapshot.contacts.length,
        followups: snapshot.followups.length,
        coverage: snapshot.coverage,
      });
      return;
    }
    const snapshot = await relationshipSnapshot(store, root);
    const settings = await readJson<RelationshipSettings>(
      join(root, "relationship-settings.json"),
      { threads: {}, lists: {} }
    );
    if (action === "save-list") {
      validateLocalName(target);
      filterContacts(snapshot, opts);
      settings.lists[target] = selectedFilters(opts);
      await writePrivate(join(root, "relationship-settings.json"), settings);
    } else if (["snooze", "dismiss", "acknowledge"].includes(action)) {
      const event = snapshot.timeline.filter((e) => e.thread === target).at(-1);
      if (!event) throw new Error("Thread not found");
      const days = opts.days ?? 1;
      if (!Number.isInteger(days) || days < 1 || days > 365)
        throw new Error("--days must be 1–365");
      settings.threads[event.thread] = {
        through: event.timestamp,
        ...(action === "snooze"
          ? { snoozeUntil: Date.now() + days * 86400000 }
          : { dismissed: true }),
      };
      await writePrivate(join(root, "relationship-settings.json"), settings);
      if (action === "acknowledge" && event.channel === "linkedin") {
        const id = event.thread.slice(`linkedin:${event.account}:`.length),
          convs = store.forAccount(event.account);
        const record = await convs.read(id);
        if (record) {
          await convs.upsert(id, { ...record, localAcknowledgedAt: event.timestamp });
          await store.git.flush();
        }
      }
    } else {
      const contact = snapshot.contacts.find(
        (c) =>
          c.id === target ||
          c.emails.includes(target ?? "") ||
          (c.attio?.status === "matched" && c.attio.emails?.includes(target ?? ""))
      );
      if (!contact) throw new Error("Contact not found");
      const identities = await mail.identities();
      if (action === "tag" || action === "untag") {
        if (!values.length) throw new Error("Supply one or more tags");
        contact.tags =
          action === "tag"
            ? [...new Set([...contact.tags, ...values])]
            : contact.tags.filter((t) => !values.includes(t));
      } else if (action === "link") {
        if (!opts.account || !opts.flagship)
          throw new Error("link requires --account and --flagship");
        const account = await store.accounts.getDefault(opts.account);
        const person = await store.peopleFor(account).readPerson(opts.flagship);
        if (!person) throw new Error("LinkedIn person not found in selected account");
        const flagship = person.flagshipId;
        const other = snapshot.contacts.find(
          (c) =>
            c.id !== contact.id &&
            c.emails.length &&
            c.linkedin.some((l) => l.account === account && l.flagshipId === flagship)
        );
        if (other) throw new Error("LinkedIn identity already linked; unlink it first");
        // A tagged LinkedIn-only node must not override the newly confirmed email link.
        // Transfer its local annotations and existing confirmed aliases before removing it.
        for (const previous of snapshot.contacts.filter(
          (c) =>
            c.id !== contact.id &&
            !c.emails.length &&
            c.linkedin.some((l) => l.account === account && l.flagshipId === flagship)
        )) {
          contact.tags = [...new Set([...contact.tags, ...previous.tags])];
          contact.inboundDays ??= previous.inboundDays;
          contact.outboundDays ??= previous.outboundDays;
          for (const link of previous.linkedin)
            if (
              !contact.linkedin.some(
                (l) => l.account === link.account && l.flagshipId === link.flagshipId
              )
            )
              contact.linkedin.push(link);
          delete identities.contacts[previous.id];
        }
        if (!contact.linkedin.some((l) => l.account === account && l.flagshipId === flagship))
          contact.linkedin.push({ account, flagshipId: flagship });
        settings.attioBlocked = (settings.attioBlocked ?? []).filter(
          (id) => id !== `${account}/${flagship}`
        );
        await writePrivate(join(root, "relationship-settings.json"), settings);
      } else if (action === "unlink") {
        if (!opts.account || !opts.flagship)
          throw new Error("unlink requires --account and --flagship");
        const account = await store.accounts.getDefault(opts.account);
        const person = await store.peopleFor(account).readPerson(opts.flagship);
        const flagship = person?.flagshipId ?? opts.flagship;
        contact.linkedin = contact.linkedin.filter(
          (l) => l.account !== account || l.flagshipId !== flagship
        );
        settings.attioBlocked = [
          ...new Set([...(settings.attioBlocked ?? []), `${account}/${flagship}`]),
        ];
        await writePrivate(join(root, "relationship-settings.json"), settings);
      } else if (action === "cadence") {
        const [inbound, outbound] = values.map(Number);
        if (
          !Number.isInteger(inbound) ||
          !Number.isInteger(outbound) ||
          !inbound ||
          !outbound ||
          inbound > 365 ||
          outbound > 365 ||
          inbound < 1 ||
          outbound < 1
        )
          throw new Error("cadence requires two business-day counts (1–365)");
        contact.inboundDays = inbound;
        contact.outboundDays = outbound;
      } else throw new Error("Unknown relationship action");
      identities.contacts[contact.id] = {
        id: contact.id,
        name: contact.name,
        emails: contact.emails,
        linkedin: contact.linkedin,
        tags: contact.tags,
        inboundDays: contact.inboundDays,
        outboundDays: contact.outboundDays,
      };
      await mail.saveIdentities(identities);
    }
    const updated = await saveSnapshot(store, root);
    output.printData({ action, target, contacts: updated.contacts.length });
  });
}
