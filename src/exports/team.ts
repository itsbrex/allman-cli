import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { canonicalPath, readSessionRegistry } from "../linkedin/session-control.js";
import { emailAddress, MailStore } from "../mail/store.js";
import { allmanConfigRoot } from "../store/config.js";
import { Store } from "../store/index.js";
import {
  readJson,
  withWorkspaceLock,
  workspaceRoot,
  writePrivate,
} from "../store/private-workspace.js";
import { archiveRaw } from "../store/raw-archive.js";
import { relationshipSnapshot } from "../store/relationships.js";
import { csvRow } from "../utils/csv.js";

export interface ExportConfig {
  version: 1;
  enabled: boolean;
  profiles: string[];
  ownerEmails: Record<string, string[]>;
}
export interface ExportRow {
  id: string;
  profile: string;
  kind: string;
  name: string;
  sourceKey: string;
  relationshipFrom: string | null;
  account: string;
  personKeys: string[];
  actorProfile: string | null;
  teamMembers: string[];
  channel: string;
  direction: string;
  status: string;
  observedAt: string | null;
  presentInLatestSnapshot: boolean;
  data: unknown;
  rawRefs: string[];
}
interface ExportDocument {
  schemaVersion: 1;
  generation: string;
  generatedAt: string;
  rows: ExportRow[];
  coverage: unknown;
}
export const exportRoot = () => join(allmanConfigRoot(), "team-exports");
export const exportConfigPath = () => join(allmanConfigRoot(), "team-export.json");
export async function readExportConfig(): Promise<ExportConfig | null> {
  const config = await readJson<ExportConfig | null>(exportConfigPath(), null);
  if (
    config &&
    (config.version !== 1 ||
      typeof config.enabled !== "boolean" ||
      !Array.isArray(config.profiles) ||
      !config.profiles.length ||
      config.profiles.includes("team") ||
      !config.profiles.every(
        (p) => typeof p === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(p)
      ) ||
      new Set(config.profiles).size !== config.profiles.length ||
      !config.ownerEmails ||
      typeof config.ownerEmails !== "object" ||
      !Object.entries(config.ownerEmails).every(
        ([p, addresses]) =>
          config.profiles.includes(p) &&
          Array.isArray(addresses) &&
          addresses.every((e) => typeof e === "string" && emailAddress(e) === e)
      ))
  )
    throw new Error("Invalid team-export.json configuration");
  if (config) {
    const addresses = Object.values(config.ownerEmails).flat();
    if (new Set(addresses).size !== addresses.length)
      throw new Error("An email address cannot belong to two teammates");
  }
  return config;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const text = (value: unknown) => (typeof value === "string" ? value : "");

async function records(
  dir: string,
  recursive = false
): Promise<Array<{ path: string; data: Record<string, unknown> }>> {
  const result: Array<{ path: string; data: Record<string, unknown> }> = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && recursive) result.push(...(await records(path, true)));
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error(`Invalid stored record: ${path}`);
      result.push({ path, data });
    }
  }
  return result;
}

async function profileRows(name: string, config: ExportConfig) {
  const profile = readSessionRegistry()?.profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Export profile is not registered: ${name}`);
  const env: NodeJS.ProcessEnv = { ...process.env, ALLMAN_PROFILE: name };
  delete env.ALLMAN_RELATIONSHIP_STORE;
  const store = new Store({ path: profile.store });
  const account = await store.accounts.getDefault(profile.account);
  const root = workspaceRoot(store.root, env);
  const snapshot = await relationshipSnapshot(store, root);
  const mail = new MailStore(root);
  const messages = new Map((await mail.messages()).map((m) => [m.key, m]));
  const owner = new Map(
    Object.entries(config.ownerEmails).flatMap(([p, emails]) => emails.map((e) => [e, p] as const))
  );
  const keys = new Map(
    snapshot.contacts.map((c) => [
      c.id,
      [
        ...c.linkedin.map((l) => `linkedin:${l.flagshipId}`),
        ...(c.linkedinUrls ?? []).map((u) => `url:${u}`),
        ...c.emails.map((e) => `email:${e.toLowerCase()}`),
      ],
    ])
  );
  const rows: ExportRow[] = [];
  const add = (kind: string, key: string, data: unknown, extra: Partial<ExportRow> = {}) => {
    rows.push({
      id: hash(`${name}/${kind}/${key}`),
      profile: name,
      kind,
      name: "",
      sourceKey: key,
      relationshipFrom: null,
      account,
      personKeys: [],
      actorProfile: null,
      teamMembers: [name],
      channel: "",
      direction: "",
      status: "stored",
      observedAt: null,
      presentInLatestSnapshot: true,
      data,
      rawRefs: [],
      ...extra,
    });
  };
  for (const c of snapshot.contacts) add("contact", c.id, c, { personKeys: keys.get(c.id) ?? [] });
  for (const e of snapshot.timeline) {
    const copies = e.sourceCopies ?? [{ id: e.id, account: e.account }];
    const sourceMail = copies.map((c) => messages.get(c.id)).filter((m) => m !== undefined);
    const senders = sourceMail.map((m) => emailAddress(m.sender)).filter((v): v is string => !!v);
    const participants = sourceMail
      .flatMap((m) => [m.sender, ...m.to.map((p) => p.address), ...m.cc.map((p) => p.address)])
      .map(emailAddress)
      .filter((v): v is string => !!v);
    const actors = [...new Set(senders.map((e) => owner.get(e)).filter((v): v is string => !!v))];
    const members = [
      ...new Set(participants.map((e) => owner.get(e)).filter((v): v is string => !!v)),
    ];
    const data =
      e.channel === "email"
        ? { ...e, sourceMessages: sourceMail.map(({ content: _body, ...metadata }) => metadata) }
        : e;
    add("activity", e.id, data, {
      account: e.account,
      channel: e.channel,
      direction: e.direction,
      personKeys: [...new Set(e.contactIds.flatMap((id) => keys.get(id) ?? []))],
      name: e.contactIds
        .map((id) => snapshot.contacts.find((c) => c.id === id)?.name)
        .filter(Boolean)
        .join("; "),
      actorProfile:
        e.channel === "linkedin"
          ? e.direction === "outbound" && e.account === account
            ? name
            : null
          : actors.length === 1
            ? (actors[0] ?? null)
            : null,
      teamMembers: e.channel === "linkedin" ? [name] : members,
      status: e.coverage,
      observedAt: new Date(e.timestamp).toISOString(),
    });
  }
  for (const f of snapshot.followups)
    add("followup", `${f.thread}/${f.contactId}`, f, {
      personKeys: keys.get(f.contactId) ?? [],
      status: f.kind,
      observedAt: new Date(f.timestamp).toISOString(),
    });
  const conversations = store.forAccount(account);
  for (const conversationId of await conversations.list()) {
    const conversation = await conversations.read(conversationId);
    if (!conversation) continue;
    const personKeys = conversation.profileId ? [`linkedin:${conversation.profileId}`] : [];
    add("conversation", conversationId, conversation, { channel: "linkedin", personKeys });
    for (const message of await conversations.readMessages(conversationId)) {
      add(
        "message",
        `${conversationId}/${message.urn}`,
        { ...message, conversationId },
        {
          channel: "linkedin",
          personKeys,
          direction: message.isFromMe ? "outbound" : "inbound",
          actorProfile: message.isFromMe ? name : null,
          observedAt: Number.isFinite(message.timestamp)
            ? new Date(message.timestamp).toISOString()
            : null,
        }
      );
    }
  }
  // Fixed allowlist only: never export AUTH, COOKIES, config, or private runtime state.
  for (const namespace of [
    "connections",
    "connections-salesnav",
    "connections-of",
    "companies",
    "invitations",
  ]) {
    for (const record of await records(
      join(store.root, account, namespace),
      namespace === "connections-of"
    )) {
      const data = { ...record.data };
      const rawRefs: string[] = [];
      if (data.raw) {
        rawRefs.push(
          await archiveRaw(
            root,
            account,
            `linkedin/profile/${text(data.flagshipId) || basename(record.path)}`,
            data.raw,
            text(data.enrichedAt) || undefined
          )
        );
        delete data.raw;
      }
      const id =
        text(data.flagshipId) ||
        text(data.inviteeId) ||
        (/^urn:li:fsd_profile:(.+)$/.exec(text(data.memberUrn))?.[1] ?? "");
      add(namespace, relative(join(store.root, account, namespace), record.path), data, {
        rawRefs,
        name:
          text(data.fullName) ||
          [text(data.firstName), text(data.lastName)].filter(Boolean).join(" ") ||
          text(data.name),
        channel: "linkedin",
        relationshipFrom:
          namespace === "connections-of"
            ? `linkedin:${basename(dirname(record.path))}`
            : ["connections", "connections-salesnav", "invitations"].includes(namespace)
              ? `linkedin:${account}`
              : null,
        personKeys: id ? [`linkedin:${id}`] : [],
        actorProfile: namespace === "invitations" ? name : null,
        direction: namespace === "invitations" ? "outbound" : "",
        status:
          namespace === "invitations"
            ? "invitation-sent; acceptance-unknown"
            : namespace === "connections" && (data.source ?? "connections") === "connections"
              ? "connection-observed"
              : "stored",
        observedAt:
          text(data.connectionObservedAt) ||
          text(data.sentAt) ||
          text(data.enrichedAt) ||
          text(data.lastSeenAt) ||
          null,
      });
    }
  }
  return { rows, coverage: { ...snapshot.coverage, rawArchive: join(root, "raw") } };
}

export function upsertExportRows(previous: ExportRow[], incoming: ExportRow[]): ExportRow[] {
  const rows = new Map(previous.map((r) => [r.id, { ...r, presentInLatestSnapshot: false }]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function exportCsv(document: ExportDocument): string {
  const columns = [
    "id",
    "profile",
    "kind",
    "name",
    "sourceKey",
    "relationshipFrom",
    "account",
    "personKeys",
    "actorProfile",
    "teamMembers",
    "channel",
    "direction",
    "status",
    "observedAt",
    "presentInLatestSnapshot",
    "rawRefs",
  ] as const;
  const safe = (value: unknown) => {
    const s =
      typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
    return /^[\s]*[=+@-]/.test(s) ? `'${s}` : s;
  };
  const extra = ["company", "title", "subject", "textPreview", "fullRecord"];
  const rows = document.rows.map((row) => {
    const data =
      row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {};
    return csvRow([
      document.generation,
      ...columns.map((c) => safe(row[c])),
      ...[
        data.company,
        data.title,
        data.subject,
        text(data.body).replace(/\s+/g, " ").slice(0, 240),
        `${row.profile}.json#row=${row.id}`,
      ].map(safe),
    ]);
  });
  return `${[csvRow(["generation", ...columns, ...extra]), ...rows].join("\r\n")}\r\n`;
}
async function atomicText(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function sourceFingerprint(config: ExportConfig): Promise<string> {
  const inputs: string[] = [JSON.stringify(config)];
  const scan = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "raw") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.isFile() && /\.jsonl?$/.test(entry.name)) {
        const info = await stat(path);
        inputs.push(`${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`);
      }
    }
  };
  for (const name of config.profiles) {
    const profile = readSessionRegistry()?.profiles.find((p) => p.name === name);
    if (!profile) throw new Error(`Export profile is not registered: ${name}`);
    const env: NodeJS.ProcessEnv = { ...process.env, ALLMAN_PROFILE: name };
    delete env.ALLMAN_RELATIONSHIP_STORE;
    inputs.push(JSON.stringify({ name, store: profile.store, account: profile.account }));
    await scan(profile.store);
    await scan(workspaceRoot(profile.store, env));
  }
  return hash(inputs.sort().join("\n"));
}

export async function refreshTeamExports(onlyIfChanged = false) {
  const config = await readExportConfig();
  if (!config)
    throw new Error("Configure exports first: allman exports configure --profiles brian,jp");
  const root = exportRoot();
  // Do not let an accidental store binding put mail or raw payloads in Git.
  for (const p of readSessionRegistry()?.profiles ?? [])
    if (
      canonicalPath(root) === canonicalPath(p.store) ||
      canonicalPath(root).startsWith(`${canonicalPath(p.store)}/`)
    )
      throw new Error("Team exports must remain outside LinkedIn stores");
  return withWorkspaceLock(root, async () => {
    const fingerprint = await sourceFingerprint(config);
    const prior = await readJson<{
      generation: string;
      fingerprint?: string;
      files: { rows: number; path: string }[];
    } | null>(join(root, "manifest.json"), null);
    if (onlyIfChanged && prior?.fingerprint === fingerprint) {
      return {
        root,
        generation: prior.generation,
        profiles: config.profiles,
        rows: prior.files.find((f) => f.path === "team.json")?.rows ?? 0,
        unchanged: true,
      };
    }
    const generation = randomUUID(),
      generatedAt = new Date().toISOString();
    const documents: Array<{ name: string; document: ExportDocument }> = [];
    for (const name of config.profiles) {
      const incoming = await profileRows(name, config);
      const previous = await readJson<ExportDocument | null>(join(root, `${name}.json`), null);
      if (previous && (previous.schemaVersion !== 1 || !Array.isArray(previous.rows)))
        throw new Error(`Invalid prior export for ${name}`);
      documents.push({
        name,
        document: {
          schemaVersion: 1,
          generation,
          generatedAt,
          rows: upsertExportRows(previous?.rows ?? [], incoming.rows),
          coverage: incoming.coverage,
        },
      });
    }
    documents.push({
      name: "team",
      document: {
        schemaVersion: 1,
        generation,
        generatedAt,
        rows: documents.flatMap((d) => d.document.rows),
        coverage: Object.fromEntries(documents.map((d) => [d.name, d.document.coverage])),
      },
    });
    if ((await sourceFingerprint(config)) !== fingerprint)
      throw new Error(
        "Source data changed during export; retry refresh after the current writes finish"
      );
    // Every file is atomic; shared generation and final manifest detect interrupted multi-file publication.
    for (const { name, document } of documents) {
      await writePrivate(join(root, `${name}.json`), document);
      await atomicText(join(root, `${name}.csv`), exportCsv(document));
    }
    await writePrivate(join(root, "manifest.json"), {
      schemaVersion: 1,
      generation,
      generatedAt,
      fingerprint,
      files: documents.flatMap(({ name, document }) => [
        { path: `${name}.json`, rows: document.rows.length },
        { path: `${name}.csv`, rows: document.rows.length },
      ]),
    });
    return {
      root,
      generation,
      profiles: config.profiles,
      rows: documents.at(-1)?.document.rows.length,
    };
  });
}
