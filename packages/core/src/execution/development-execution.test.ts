import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderEnv } from "@bureauos/providers";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { defaultConfig } from "../config/loader.js";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { buildDevelopmentExecution } from "./development-execution.js";

describe("buildDevelopmentExecution (SER-239)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-dev-exec-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function deps(config: BureauConfig = defaultConfig("agency"), env?: ProviderEnv) {
    const approvals = new ApprovalRegistry(dir);
    return {
      config,
      approvals,
      artifacts: new ArtifactStore(dir),
      audit: new AuditLog(workspacePaths(dir).auditLog),
      policy: new PolicyEngine(config, approvals),
      // Default to an empty env so tests never depend on the host environment.
      env: env ?? {},
    };
  }

  it("returns nothing when the codex runtime is disabled (default)", async () => {
    const { config, ...rest } = deps();
    const result = await buildDevelopmentExecution(dir, config, rest);
    expect(result.developmentRuntime).toBeUndefined();
    expect(result.capabilityUse).toBeUndefined();
  });

  it("builds the runtime and its capability checker as a strict pair when enabled", async () => {
    const config = defaultConfig("agency");
    config.runtime.codex.enabled = true;
    const { config: cfg, ...rest } = deps(config);
    const result = await buildDevelopmentExecution(dir, cfg, rest);
    // The two must come together: a real runtime without a gate would let the
    // development agent skip its fail-closed edit_code/run_tests checks.
    expect(result.developmentRuntime).toBeDefined();
    expect(result.capabilityUse).toBeDefined();
  });

  it("builds a provider-backed runtime when codegen_mode='provider' and a provider is available", async () => {
    const config = defaultConfig("agency");
    config.runtime.codex.enabled = true;
    config.runtime.codex.codegen_mode = "provider";
    // Point the development role at an api-key provider that registers from env.
    config.agents.development = {
      provider: "anthropic",
      model: "claude-opus-4-7",
      capabilities: [],
      required_model_capabilities: [],
      prefer_low_cost: false,
    };
    const { config: cfg, ...rest } = deps(config, { ANTHROPIC_API_KEY: "sk-test-fake" });

    const result = await buildDevelopmentExecution(dir, cfg, rest);

    // A provider was resolvable, so the runtime is still built (provider path).
    expect(result.developmentRuntime).toBeDefined();
    expect(result.capabilityUse).toBeDefined();
  });

  it("falls back to a runtime (never throws) when codegen_mode='provider' but no provider is available", async () => {
    const config = defaultConfig("agency");
    config.runtime.codex.enabled = true;
    config.runtime.codex.codegen_mode = "provider";
    // Empty env + no stored credentials => no provider resolves. The runtime must
    // still be built (command path fallback) rather than throwing or vanishing.
    const { config: cfg, ...rest } = deps(config, {});

    const result = await buildDevelopmentExecution(dir, cfg, rest);

    expect(result.developmentRuntime).toBeDefined();
    expect(result.capabilityUse).toBeDefined();
  });
});
