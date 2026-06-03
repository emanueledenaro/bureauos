import {
  buildConfiguredProviderRouter,
  type ProviderEnv,
  type RuntimeAdapter,
} from "@bureauos/providers";
import type { ArtifactStore } from "../artifacts/store.js";
import type { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { ApprovalRegistry } from "../registries/approval.js";
import { configureAgentProviderRouting, selectAgentModel } from "../agents/provider-routing.js";
import { CapabilityUseService } from "../capabilities/usage.js";
import { buildCodexRuntimeFromConfig, type BuildCodexRuntimeOptions } from "./codex-runtime.js";

export interface DevelopmentExecutionDeps {
  artifacts: ArtifactStore;
  approvals: ApprovalRegistry;
  policy: PolicyEngine;
  audit: AuditLog;
  /**
   * Provider environment used to resolve the model provider when
   * `runtime.codex.codegen_mode === "provider"`. Defaults to `process.env`.
   */
  env?: ProviderEnv;
}

export interface DevelopmentExecution {
  developmentRuntime?: RuntimeAdapter;
  capabilityUse?: CapabilityUseService;
}

// Fallback output ceiling for a single provider codegen turn, used only if
// config lacks `runtime.codex.codegen_max_tokens`. A multi-file site needs more
// than a few thousand tokens or the response truncates before the last file
// (e.g. the entry-point index.html), so this is generous. The runner also caps
// total bytes via maxOutputChars (config: codegen_max_chars).
const PROVIDER_CODEGEN_MAX_TOKENS = 16000;
const PROVIDER_CODEGEN_TEMPERATURE = 0.2;

/**
 * Build the development-execution wiring from config: the policy-gated Codex
 * runtime and the capability checker the development agent needs to evaluate its
 * `edit_code` / `run_tests` gates (those gates fail closed without it). The two
 * are constructed as a strict pair, so a run can never get a real runtime
 * without a gate. Returns `{}` when `runtime.codex.enabled` is false (the dev
 * agent then stays template-only).
 *
 * When `runtime.codex.codegen_mode === "provider"`, this also resolves the
 * connected model provider (development role) and passes a `generate` closure to
 * {@link buildCodexRuntimeFromConfig} so the runtime asks the LLM to emit files
 * directly (still behind the `CodexRuntimeAdapter` safety boundary). If no
 * provider is available or selection fails, it behaves exactly like today
 * (template-only / command path) rather than throwing — the providers package
 * stays router-free; only this core seam knows about routing.
 *
 * Single source of truth so the CLI run/dispatch paths cannot drift (SER-239).
 */
export async function buildDevelopmentExecution(
  workspaceRoot: string,
  config: BureauConfig,
  deps: DevelopmentExecutionDeps,
): Promise<DevelopmentExecution> {
  const codex = config.runtime?.codex;
  if (!codex || !codex.enabled) return {};

  const runtimeOptions: BuildCodexRuntimeOptions = {};
  if (codex.codegen_mode === "provider") {
    const providerGenerate = await buildProviderGenerate(workspaceRoot, config, deps.env);
    if (providerGenerate) runtimeOptions.providerGenerate = providerGenerate;
    // If no provider is available the runtime falls back to the host path; the
    // dev agent then degrades to command/template behavior, never throwing.
  }

  const developmentRuntime = buildCodexRuntimeFromConfig(config, runtimeOptions);
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

/**
 * Resolve the development-role provider and wrap a `generate` closure for the
 * provider codegen runner. Returns `undefined` (so the caller falls back to the
 * command path) when no provider is configured/available or any step fails.
 */
async function buildProviderGenerate(
  workspaceRoot: string,
  config: BureauConfig,
  env: ProviderEnv = process.env,
): Promise<((req: { system: string; prompt: string }) => Promise<string>) | undefined> {
  try {
    const { router } = await buildConfiguredProviderRouter(workspaceRoot, env, config);
    configureAgentProviderRouting(router, config, ["development"]);
    const selection = await selectAgentModel(router, config, "development");
    if (!selection) return undefined;
    return async ({ system, prompt }) => {
      const result = await selection.provider.generateText({
        model: selection.model,
        system,
        prompt,
        temperature: PROVIDER_CODEGEN_TEMPERATURE,
        maxTokens: config.runtime?.codex?.codegen_max_tokens ?? PROVIDER_CODEGEN_MAX_TOKENS,
      });
      return result.text;
    };
  } catch {
    return undefined;
  }
}
