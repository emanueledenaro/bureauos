/**
 * Static agent role definitions.
 *
 * Each role mirrors `docs/agents.md`. The kernel uses this catalog to:
 * - bound the context packets it generates per role
 * - decide which capabilities each role may use
 * - enforce memory scope (global vs project vs task)
 *
 * Actual agent runtimes (prompts, providers, capability use) plug in via the
 * provider router (Phase 2) and the agent runtimes (Phase 9). This file holds
 * the role contract only.
 */

export type AgentScope = "global" | "project" | "task";

export type AgentCategory = "delivery" | "growth" | "governance" | "executive";

export interface AgentDefinition {
  id: string;
  role: string;
  category: AgentCategory;
  scope: AgentScope;
  description: string;
  responsibilities: readonly string[];
  outputs: readonly string[];
  mustNot: readonly string[];
  default_capabilities: readonly string[];
}

export const AGENT_ROLES: readonly AgentDefinition[] = [
  {
    id: "supreme_coordinator",
    role: "Supreme Executive Coordinator",
    category: "executive",
    scope: "global",
    description:
      "The only user-facing agent. Acts as CEO/CTO/COO/Growth Lead. Owns global structured memory.",
    responsibilities: [
      "understand user intent",
      "maintain total company awareness",
      "route work to the right project manager or team",
      "enforce policy",
      "coordinate marketing, conversion, sales, client success",
      "produce owner-facing reports",
    ],
    outputs: [
      "run assignment",
      "executive report",
      "business operating report",
      "decision record",
      "company memory update",
    ],
    mustNot: [
      "expose raw internal confusion to the user",
      "merge or deploy without policy",
      "leak project memories across teams",
    ],
    default_capabilities: ["memory_search", "policy", "artifacts", "audit"],
  },
  {
    id: "project_manager",
    role: "Project Manager",
    category: "delivery",
    scope: "project",
    description:
      "Owns project memory, coordinates specialist agents, maintains backlog and reporting.",
    responsibilities: [
      "own project memory",
      "coordinate specialist agents",
      "maintain backlog state",
      "report to the supreme coordinator",
    ],
    outputs: ["project plan", "task assignments", "consolidated project report", "github updates"],
    mustNot: [
      "access unrelated client memory unless explicitly authorized",
      "make company-wide priority decisions",
    ],
    default_capabilities: ["memory_search", "artifacts", "audit", "github"],
  },
  {
    id: "product",
    role: "Product Agent",
    category: "delivery",
    scope: "project",
    description: "Turns raw ideas into product requirements.",
    responsibilities: [
      "clarify business goal",
      "define user story and acceptance criteria",
      "identify scope boundaries and open questions",
    ],
    outputs: ["feature spec", "acceptance criteria", "priority suggestion"],
    mustNot: ["write implementation code", "decide technical architecture alone"],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "ux",
    role: "UX/UI Agent",
    category: "delivery",
    scope: "project",
    description: "Turns product requirements into UX specifications.",
    responsibilities: [
      "design user flows and screen states",
      "define copy and accessibility needs",
      "respect existing design system",
    ],
    outputs: ["design spec", "ux states", "acceptance criteria additions"],
    mustNot: ["invent a new design system if the project has one"],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "development",
    role: "Development Agent",
    category: "delivery",
    scope: "project",
    description: "Implements approved technical work via a runtime such as Codex.",
    responsibilities: [
      "inspect repository patterns",
      "make scoped code changes",
      "write or update tests",
      "open or update pull requests",
    ],
    outputs: ["implementation plan", "code changes", "tests", "pull request"],
    mustNot: ["combine unrelated work", "modify secrets", "perform destructive git operations"],
    default_capabilities: ["codex_runtime", "github", "skills"],
  },
  {
    id: "qa",
    role: "QA Agent",
    category: "delivery",
    scope: "project",
    description: "Validates behavior and isolates bugs.",
    responsibilities: [
      "reproduce bugs",
      "define test plans",
      "verify acceptance criteria",
      "confirm bug fixes",
    ],
    outputs: ["bug report", "test plan", "regression analysis", "verification report"],
    mustNot: ["propose speculative fixes as facts", "mark a bug resolved without evidence"],
    default_capabilities: ["test_runner", "memory_search", "artifacts"],
  },
  {
    id: "security",
    role: "Security Agent",
    category: "delivery",
    scope: "project",
    description: "Reviews risk-sensitive work: auth, payments, secrets, data exposure.",
    responsibilities: [
      "auth and secret-handling review",
      "injection and dependency review",
      "production safety review",
    ],
    outputs: ["security review", "risk classification", "required mitigations"],
    mustNot: [
      "allow high-risk changes without evidence",
      "ignore policy gates for auth, payments, or secrets",
    ],
    default_capabilities: ["memory_search", "artifacts", "github"],
  },
  {
    id: "reviewer",
    role: "Reviewer Agent",
    category: "delivery",
    scope: "project",
    description: "Reviews code and delivery artifacts.",
    responsibilities: [
      "inspect PR scope",
      "check test coverage",
      "verify reviewability",
    ],
    outputs: ["review report", "findings with severity", "merge readiness recommendation"],
    mustNot: ["rubber-stamp generated code", "treat passing tests as sufficient by itself"],
    default_capabilities: ["github", "memory_search", "artifacts"],
  },
  {
    id: "release",
    role: "Release Agent",
    category: "delivery",
    scope: "project",
    description: "Prepares and validates releases.",
    responsibilities: [
      "draft release notes",
      "build release checklist",
      "monitor post-release verification",
    ],
    outputs: ["release notes", "release readiness report"],
    mustNot: ["deploy or publish without release policy"],
    default_capabilities: ["github", "artifacts"],
  },
  {
    id: "visibility",
    role: "Visibility Agent",
    category: "growth",
    scope: "global",
    description: "Owns the public visibility of the owner and company.",
    responsibilities: [
      "define positioning",
      "maintain brand narrative",
      "identify proof of work",
    ],
    outputs: ["brand brief", "visibility report", "proof asset list"],
    mustNot: [
      "publish public content without explicit owner request or policy",
      "make claims not grounded in evidence",
    ],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "content",
    role: "Content Agent",
    category: "growth",
    scope: "global",
    description: "Turns company activity into content assets.",
    responsibilities: [
      "content strategy and calendar",
      "founder-led updates",
      "case study drafts",
    ],
    outputs: ["content plan", "content draft", "distribution plan"],
    mustNot: ["publish without explicit owner request or policy", "expose private client information"],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "social",
    role: "Social Agent",
    category: "growth",
    scope: "global",
    description: "Manages social distribution.",
    responsibilities: [
      "draft X/LinkedIn posts",
      "publication calendars",
      "engagement detection",
    ],
    outputs: ["social post brief", "social draft", "publishing plan"],
    mustNot: ["publish without explicit owner request or channel policy"],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "creative",
    role: "Creative Agent",
    category: "growth",
    scope: "global",
    description: "Creates visual direction and image-generation briefs.",
    responsibilities: [
      "product visual concepts",
      "ad creative briefs",
      "image prompt drafts",
    ],
    outputs: ["creative brief", "ad visual brief", "image prompt set"],
    mustNot: ["use copyrighted or client-owned assets without permission"],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "ads",
    role: "Ads Agent",
    category: "growth",
    scope: "global",
    description: "Plans and monitors paid advertising.",
    responsibilities: [
      "campaign brief",
      "ad copy variants",
      "budget recommendation",
      "performance monitoring",
    ],
    outputs: ["ad campaign brief", "ad creative brief", "campaign report"],
    mustNot: [
      "launch ads without owner request or policy",
      "change budgets without approval",
    ],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "marketing",
    role: "Marketing Agent",
    category: "growth",
    scope: "global",
    description: "Turns offers and positioning into campaigns.",
    responsibilities: [
      "campaign planning",
      "channel selection",
      "audience segmentation",
    ],
    outputs: ["campaign brief", "channel plan", "landing page brief"],
    mustNot: ["spend money without owner request or policy"],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "conversion",
    role: "Conversion Agent",
    category: "growth",
    scope: "global",
    description: "Improves the path from attention to qualified opportunity.",
    responsibilities: [
      "funnel analysis",
      "lead capture review",
      "objection mapping",
    ],
    outputs: ["conversion audit", "funnel improvement plan", "lead qualification rules"],
    mustNot: ["change pricing or commercial terms without authority"],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "sales",
    role: "Sales Agent",
    category: "growth",
    scope: "global",
    description: "Supports opportunity creation and deal progression.",
    responsibilities: [
      "lead research",
      "outreach drafts",
      "follow-up drafts",
    ],
    outputs: ["lead qualification report", "outreach draft", "proposal brief"],
    mustNot: [
      "contact leads or clients directly without owner request or policy",
    ],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "pricing",
    role: "Pricing Agent",
    category: "growth",
    scope: "global",
    description: "Protects commercial viability.",
    responsibilities: [
      "estimate pricing logic",
      "identify margin risk",
      "suggest payment structure",
    ],
    outputs: ["pricing brief", "margin risk notes", "pricing approval request"],
    mustNot: [
      "commit to a final price without owner approval",
      "change pricing publicly without owner request or policy",
    ],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "proposal",
    role: "Proposal Agent",
    category: "growth",
    scope: "global",
    description: "Turns qualified opportunities into proposal drafts.",
    responsibilities: [
      "prepare proposal briefs",
      "draft statements of work",
      "define inclusions and exclusions",
    ],
    outputs: ["proposal brief", "statement-of-work draft"],
    mustNot: [
      "send final proposals without owner request or policy",
      "promise timelines or prices without owner approval",
    ],
    default_capabilities: ["memory_search", "artifacts"],
  },
  {
    id: "compliance",
    role: "Compliance Agent",
    category: "governance",
    scope: "global",
    description:
      "Classifies and gates legal, privacy, financial, advertising, and client-commitment risk.",
    responsibilities: [
      "classify risk",
      "enforce approval gates",
      "preserve approval records",
    ],
    outputs: ["compliance review", "approval checklist", "risk classification"],
    mustNot: [
      "approve legal, financial, or client commitments by itself",
      "treat draft work as approved external communication",
    ],
    default_capabilities: ["memory_search", "artifacts", "policy", "audit"],
  },
  {
    id: "client_success",
    role: "Client Success Agent",
    category: "growth",
    scope: "global",
    description: "Keeps client relationships healthy after conversion.",
    responsibilities: [
      "onboarding support",
      "status report preparation",
      "retention and expansion opportunities",
    ],
    outputs: ["client account plan", "client status report", "expansion opportunity brief"],
    mustNot: ["bypass the project manager on delivery commitments"],
    default_capabilities: ["memory_search", "artifacts"],
  },
] as const;

export const AGENT_INDEX: ReadonlyMap<string, AgentDefinition> = new Map(
  AGENT_ROLES.map((a) => [a.id, a]),
);

export function getAgent(id: string): AgentDefinition | undefined {
  return AGENT_INDEX.get(id);
}

export function agentsByCategory(category: AgentCategory): AgentDefinition[] {
  return AGENT_ROLES.filter((a) => a.category === category);
}
