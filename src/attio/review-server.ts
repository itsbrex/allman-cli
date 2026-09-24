import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

export async function latestReviewFile(root: string, filename: "review.json" | "review.html") {
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  );
  const candidates: { path: string; modified: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, filename);
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info?.isFile()) candidates.push({ path, modified: info.mtimeMs });
  }
  candidates.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
  if (!candidates[0])
    throw new Error(
      `No ${filename} found for the selected account. Run enrich-list history, then enrich-list review <RUN_ID> --html, or provide ALLMAN_REVIEW_HTML with an existing file.`
    );
  return candidates[0].path;
}

/** Serve one private report. Refresh its content and matching CSP together on every GET. */
export function createReviewServer(file: string, publicOrigin: string, port: number) {
  return createServer(async (req, res) => {
    if (
      ![`127.0.0.1:${port}`, `localhost:${port}`, "allman-enrichment.localhost"].includes(
        req.headers.host ?? ""
      ) ||
      (req.headers.origin && req.headers.origin !== publicOrigin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (req.method !== "GET" || !["/", "/apps/target-enrichment.html"].includes(req.url ?? "")) {
      res.writeHead(404).end("Not found");
      return;
    }
    try {
      const html = await readFile(file, "utf8");
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
        .map(
          (m) =>
            `'sha256-${createHash("sha256")
              .update(m[1] ?? "")
              .digest("base64")}'`
        )
        .join(" ");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; script-src ${hashes}; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      res.end(html);
    } catch {
      res
        .writeHead(503, { "Content-Type": "text/plain", "Cache-Control": "no-store" })
        .end("Review file unavailable. Regenerate the selected report, then reload.");
    }
  });
}
