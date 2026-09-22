import { readFile } from "node:fs/promises";
import { defineIcp, getIcp, readIcps } from "../relationships/icp.js";
import { resolveStorePath } from "../store/index.js";
import { withWorkspaceLock, workspaceRoot } from "../store/private-workspace.js";
import * as output from "../utils/output.js";
export interface IcpOptions {
  store?: string;
  json?: boolean;
  file?: string;
}
export async function icpCommand(action: string, id: string | undefined, opts: IcpOptions) {
  const root = workspaceRoot(resolveStorePath(opts.store));
  if (action === "list")
    return output.printData(
      Object.values((await readIcps(root)).definitions).map((versions) => versions.at(-1))
    );
  if (!id) throw new Error("Supply an ICP id");
  if (action === "show") return output.printData(await getIcp(root, id));
  if (action === "history") {
    await getIcp(root, id);
    return output.printData((await readIcps(root)).definitions[id]);
  }
  if (action !== "define") throw new Error("Use icp define, list, show or history");
  if (!opts.file) throw new Error("icp define requires --file <definition.json>");
  const value: unknown = JSON.parse(await readFile(opts.file, "utf8"));
  output.printData(await withWorkspaceLock(root, () => defineIcp(root, id, value)));
}
