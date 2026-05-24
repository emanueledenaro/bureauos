import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";

export interface GitHubIssueOpportunitySource {
  number: number;
  title: string;
  url: string;
}

export async function createGitHubIssueOpportunities(args: {
  clients: ClientRegistry;
  opportunities: OpportunityRegistry;
  owner: string;
  repo: string;
  issues: readonly GitHubIssueOpportunitySource[];
  clientSlug?: string;
}): Promise<OpportunityRecord[]> {
  let clientId = "";
  if (args.clientSlug) {
    const client = await args.clients.get(args.clientSlug);
    if (!client) throw new Error(`client not found: ${args.clientSlug}`);
    clientId = client.id;
  }

  const existing = await args.opportunities.list();
  const knownSources = new Set(existing.map((opportunity) => opportunity.source));
  const created: OpportunityRecord[] = [];
  for (const issue of args.issues) {
    const source = `github:${args.owner}/${args.repo}#${issue.number}`;
    if (knownSources.has(source)) continue;
    created.push(
      await args.opportunities.create({
        title: issue.title,
        source,
        clientId,
        notes: `Imported from ${issue.url}`,
      }),
    );
    knownSources.add(source);
  }
  return created;
}
