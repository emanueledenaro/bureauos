import type { RuntimeAdapter } from "@bureauos/providers";
import type { ArtifactStore } from "../artifacts/store.js";
import type { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { ApprovalRegistry } from "../registries/approval.js";
import { CapabilityUseService } from "../capabilities/usage.js";
import { buildCodexRuntimeFromConfig } from "./codex-runtime.js";

export interface DevelopmentExecutionDeps {
  artifacts: ArtifactStore;
  approvals: ApprovalRegistry;
  policy: PolicyEngine;
  audit: AuditLog;
}

export interface DevelopmentExecution {
  developmentRuntime?: RuntimeAdapter;
  capabilityUse?: CapabilityUseService;
}

/**
 * Build the development-execution wiring from config: the policy-gated Codex
 * runtime and the capability checker the development agent needs to evaluate its
 * `edit_code` / `run_tests` gates (those gates fail closed without it). The two
 * are constructed as a strict pair, so a run can never get a real runtime
 * without a gate. Returns `{}` when `runtime.codex.enabled` is false (the dev
 * agent then stays template-only).
 *
 * Single source of truth so the CLI run/dispatch paths cannot drift (SER-239).
 */
export function buildDevelopmentExecution(
  workspaceRoot: string,
  config: BureauConfig,
  deps: DevelopmentExecutionDeps,
): DevelopmentExecution {
  const developmentRuntime = buildCodexRuntimeFromConfig(config);
  if (!developmentRuntime) return {};
  return {
    developmentRuntime,
    capabilityUse: new CapabilityUseService(workspaceRoot, {
      config,
      artifacts: deps.artifacts,
      approvals: deps.approvals,
      policy: deps.policy,
      audit: deps.audit,
    }),
  };
}
