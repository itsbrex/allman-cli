import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Durable, private, unique directories. Never cleaned by builds or QA teardown. */
export async function artifactDirectory(label: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(label)) throw new Error("Invalid artifact label");
  const root = join(dirname(fileURLToPath(import.meta.url)), "../artifacts/local");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return mkdtemp(join(root, `${stamp}-${label}-`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await artifactDirectory(process.argv[2] ?? "work"));
}
