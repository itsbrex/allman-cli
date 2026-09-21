import { stableId } from "../mail/store.js";
import type { TimelineEvent } from "./relationships.js";
/** Coalesce verified duplicate copies while retaining every account and thread reference. */
export function coalesceTimeline(events: TimelineEvent[]): TimelineEvent[] {
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    let current = key;
    while (parent.has(current)) current = parent.get(current) as string;
    return current;
  };
  const duplicates = new Map<string, TimelineEvent>();
  for (const original of events) {
    const event: TimelineEvent = {
      ...original,
      sourceCopies: original.sourceCopies ?? [
        {
          account: original.account,
          id: original.id,
          source: original.source,
          thread: original.thread,
        },
      ],
    };
    const key =
      event.channel === "email" && event.references[0]
        ? stableId(
            JSON.stringify([
              event.references[0],
              event.timestamp,
              event.direction,
              [...event.contactIds].sort(),
              event.subject,
              event.body,
            ])
          )
        : event.id;
    const previous = duplicates.get(key);
    if (!previous) {
      duplicates.set(key, event);
      continue;
    }
    const a = root(previous.thread),
      b = root(event.thread);
    if (a !== b) parent.set(b, a);
    previous.sourceCopies = [...(previous.sourceCopies ?? []), ...(event.sourceCopies ?? [])];
    previous.coverage =
      previous.coverage === "partial" || event.coverage === "partial" ? "partial" : "stored";
    previous.eligible = previous.eligible && event.eligible;
  }
  const aliases = new Map<string, Set<string>>();
  for (const e of events) {
    const r = root(e.thread),
      group = aliases.get(r) ?? new Set<string>();
    group.add(e.thread);
    aliases.set(r, group);
  }
  return [...duplicates.values()]
    .map((e) => ({
      ...e,
      thread: root(e.thread),
      threadAliases: [...(aliases.get(root(e.thread)) ?? [e.thread])],
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}
