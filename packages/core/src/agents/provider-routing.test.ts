import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { AGENT_INDEX } from "./roles.js";
import { providerChainForRole } from "./provider-routing.js";

describe("agent provider routing", () => {
  it("keeps OpenAI Codex OAuth separate from the OpenAI API provider", () => {
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "openai-codex";
    const product = AGENT_INDEX.get("product");
    expect(product).toBeDefined();

    expect(providerChainForRole(config, product!)).toEqual(["openai-codex-default"]);
  });

  it("uses OpenAI API only when the owner explicitly chooses it", () => {
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "openai";
    const product = AGENT_INDEX.get("product");
    expect(product).toBeDefined();

    expect(providerChainForRole(config, product!)).toEqual(["openai-default"]);
  });

  it("maps the Codex runtime preference to the Codex OAuth route without API fallback", () => {
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "codex";
    const product = AGENT_INDEX.get("product");
    expect(product).toBeDefined();

    expect(providerChainForRole(config, product!)).toEqual(["openai-codex-default"]);
  });
});
