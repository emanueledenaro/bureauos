export interface ParsedGitHubRepository {
  owner: string;
  repo: string;
  repository: string;
}

export function parseGitHubRepository(value: string): ParsedGitHubRepository | undefined {
  const clean = value.trim().replace(/\.git$/, "");
  if (!clean) return undefined;

  const ssh = clean.match(/^git@github\.com[:/]([^/\s]+)\/([^/\s]+)$/);
  if (ssh) {
    const owner = ssh[1]!;
    const repo = ssh[2]!.replace(/\.git$/, "");
    return { owner, repo, repository: `${owner}/${repo}` };
  }

  try {
    const url = new URL(clean);
    if (url.hostname.toLowerCase() !== "github.com") return undefined;
    const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !rawRepo) return undefined;
    const repo = rawRepo.replace(/\.git$/, "");
    return { owner, repo, repository: `${owner}/${repo}` };
  } catch {
    const shorthand = clean.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (shorthand) {
      const owner = shorthand[1]!;
      const repo = shorthand[2]!.replace(/\.git$/, "");
      return { owner, repo, repository: `${owner}/${repo}` };
    }
  }

  return undefined;
}
