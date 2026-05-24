import type { AgentDeps, AgentRuntime } from "../runtime.js";
import { AgentRegistry } from "../runtime.js";
import { ProjectManagerAgent } from "./project-manager.js";
import { ProductAgent } from "./product.js";
import { DevelopmentAgent } from "./development.js";
import { QaAgent } from "./qa.js";
import { SecurityAgent } from "./security.js";
import { ComplianceAgent } from "./compliance.js";

export { ProjectManagerAgent } from "./project-manager.js";
export { ProductAgent } from "./product.js";
export { DevelopmentAgent } from "./development.js";
export { QaAgent } from "./qa.js";
export { SecurityAgent } from "./security.js";
export { ComplianceAgent } from "./compliance.js";

/**
 * Build an AgentRegistry pre-populated with the concrete role stubs.
 * Roles without a concrete implementation fall through to the generic
 * StubAgent on first lookup.
 */
export function buildDefaultAgentRegistry(deps: AgentDeps): AgentRegistry {
  const registry = new AgentRegistry(deps);
  const concretes: AgentRuntime[] = [
    new ProjectManagerAgent(deps),
    new ProductAgent(deps),
    new DevelopmentAgent(deps),
    new QaAgent(deps),
    new SecurityAgent(deps),
    new ComplianceAgent(deps),
  ];
  for (const agent of concretes) {
    registry.register(agent);
  }
  return registry;
}
