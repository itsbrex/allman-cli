const TAG = /^20\d{2}-\d{2}-\d{2}\.\d+(?:-(?:alpha|beta))?$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export function releaseOptions(args: string[]) {
  let tag: string | undefined,
    repo: string | undefined,
    publish = false,
    dryRun = false,
    skipTests = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--publish") publish = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--skip-tests") skipTests = true;
    else if (arg === "--repo") {
      repo = args[++i];
      if (!repo || !REPOSITORY.test(repo)) throw new Error("--repo requires owner/repository");
    } else if (!arg?.startsWith("--") && !tag) tag = arg;
    else throw new Error(`Unknown or repeated argument: ${arg}`);
  }
  if (!tag || !TAG.test(tag)) throw new Error("Supply tag YYYY-MM-DD.N[-alpha|-beta]");
  if (publish && dryRun) throw new Error("--publish and --dry-run are mutually exclusive");
  if (publish && !repo) throw new Error("Publication requires --publish --repo owner/repository");
  return { tag, repo, dryRun: !publish, skipTests };
}
export function repositoryFromRemote(remote: string): string {
  const match = remote
    .trim()
    .match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)\/?$/i
    );
  const repository = match?.[1]?.replace(/\.git$/i, "");
  if (!repository || !REPOSITORY.test(repository))
    throw new Error("Release remote must identify a GitHub owner/repository");
  return repository.toLowerCase();
}
export function assertPublicationTarget(repo: string, fetchRemote: string, pushRemote: string) {
  if (
    !REPOSITORY.test(repo) ||
    repositoryFromRemote(fetchRemote) !== repo.toLowerCase() ||
    repositoryFromRemote(pushRemote) !== repo.toLowerCase()
  )
    throw new Error("Explicit release repository must match both origin fetch and push URLs");
}
