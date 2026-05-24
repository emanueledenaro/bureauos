import type { AgentDeps, AgentRuntime } from "../runtime.js";
import { AgentRegistry } from "../runtime.js";
import { ProjectManagerAgent } from "./project-manager.js";
import { ProductAgent } from "./product.js";
import { DevelopmentAgent } from "./development.js";
import { QaAgent } from "./qa.js";
import { SecurityAgent } from "./security.js";
import { ComplianceAgent } from "./compliance.js";
import { templateAgents } from "./generic.js";

export { ProjectManagerAgent } from "./project-manager.js";
export { ProductAgent } from "./product.js";
export { DevelopmentAgent } from "./development.js";
export { QaAgent } from "./qa.js";
export { SecurityAgent } from "./security.js";
export { ComplianceAgent } from "./compliance.js";
export { templateAgents } from "./generic.js";

/**
 * Build an AgentRegistry pre-populated with concrete role stubs.
 *
 * Six fully hand-written role implementations are registered for the
 * delivery loop (PM, Product, Development, QA, Security, Compliance).
 * The remaining roles are wired through a uniform template-driven stub
 * that emits the role's signature artifact (executive-report, brand-brief,
 * campaign-brief, ...). LLM-driven prompts replace these bodies in the
 * later Phase 9 iteration.
 */
export function buildDefaultAgentRegistry(deps: AgentDeps): AgentRegistry {
  const registry = new AgentRegistry(deps);
  const handwritten: AgentRuntime[] = [
    new ProjectManagerAgent(deps),
    new ProductAgent(deps),
    new DevelopmentAgent(deps),
    new QaAgent(deps),
    new SecurityAgent(deps),
    new ComplianceAgent(deps),
  ];
  for (const agent of handwritten) registry.register(agent);
  for (const agent of templateAgents(deps)) registry.register(agent);
  return registry;
}
