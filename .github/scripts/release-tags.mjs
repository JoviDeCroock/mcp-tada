// Shared by has-unpublished-packages.mjs and stage-packages.mjs.
//
// Publishing is two-phase: `pnpm stage publish` uploads a version that stays invisible on the
// registry until someone runs `npm stage approve`. In that window the registry still reports the
// version as unpublished, so a naive check would stage it again on the next push to main and then
// fail on the `name@version` git tag and GitHub release the first run already created. The tag is
// therefore the marker for "staged, awaiting approval": if it exists on the remote, leave the
// version alone.
import { spawnSync } from "node:child_process";

export function releaseTagName(name, version) {
  return `${name}@${version}`;
}

/** True when `refs/tags/<name>@<version>` exists on the GitHub remote. Uses the REST API with
 * `GITHUB_TOKEN` when both it and `GITHUB_REPOSITORY` are set (the checkout does not persist
 * credentials), and falls back to `git ls-remote` otherwise. */
export async function hasRemoteReleaseTag(name, version) {
  const tag = releaseTagName(name, version);
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  if (repo && token) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(`Failed to look up tag ${tag}: ${response.status} ${response.statusText}`);
    }
    return true;
  }

  const result = spawnSync(
    "git",
    ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status === 0) return true;
  if (result.status === 2) return false;
  throw new Error(`Failed to look up tag ${tag} via git ls-remote: ${result.stderr}`);
}
