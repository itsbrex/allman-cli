import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createReviewServer, latestReviewFile } from "../../src/attio/review-server.js";

let root: string;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it("selects newest existing review within only the supplied account", async () => {
  root = await mkdtemp(join(tmpdir(), "allman-review-server-"));
  for (const dir of ["old", "new", "incomplete"]) await mkdir(join(root, dir));
  const old = join(root, "old/review.html"),
    latest = join(root, "new/review.html");
  await writeFile(old, "old");
  await utimes(old, 1, 1);
  await writeFile(latest, "new");
  expect(await latestReviewFile(root, "review.html")).toBe(latest);
  await expect(latestReviewFile(root, "review.json")).rejects.toThrow("No review.json");
  await expect(latestReviewFile(join(root, "other-account"), "review.html")).rejects.toThrow(
    "selected account"
  );
});

it("reloads HTML and CSP together, rejects foreign requests, and handles missing files", async () => {
  root = await mkdtemp(join(tmpdir(), "allman-review-server-"));
  const file = join(root, "review.html");
  await writeFile(file, "<script>window.first=1</script>");
  const server = createReviewServer(file, "https://allman-enrichment.localhost", 0);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  const get = (path = "/", headers = {}, method = "GET") =>
    new Promise<{ status: number; body: string; csp: string }>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: address.port,
          path,
          method,
          headers: { host: "allman-enrichment.localhost", ...headers },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body,
              csp: String(res.headers["content-security-policy"] ?? ""),
            })
          );
        }
      );
      req.on("error", reject);
      req.end();
    });
  try {
    expect((await get()).body).toContain("window.first=1");
    await writeFile(file, "<script>window.second=2</script>");
    const next = await get("/apps/target-enrichment.html");
    expect(next.body).toContain("window.second=2");
    expect(next.csp).toContain(createHash("sha256").update("window.second=2").digest("base64"));
    expect((await get("/", { host: "evil.example" })).status).toBe(403);
    expect((await get("/", { origin: "https://evil.example" })).status).toBe(403);
    expect((await get("/", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await get("/manifest.json")).status).toBe(404);
    expect((await get("/", {}, "POST")).status).toBe(404);
    await rm(file);
    expect((await get()).status).toBe(503);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
