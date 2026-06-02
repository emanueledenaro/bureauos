import { describe, expect, it } from "vitest";
import { reasoningStepForStatus } from "./reasoning";

describe("reasoning", () => {
  it("maps each stream status to a labelled step", () => {
    expect(reasoningStepForStatus("started").fallback).toBe("Reading company context");
    expect(reasoningStepForStatus("provider_streaming").fallback).toBe("Drafting the reply");
    expect(reasoningStepForStatus("persisting").fallback).toBe("Saving to memory");
  });

  it("exposes an i18n key per step", () => {
    expect(reasoningStepForStatus("started").key).toBe("reasoning.readingContext");
  });

  it("falls back to the generic 'working' step for an unknown status", () => {
    // @ts-expect-error — exercising the default branch with a status outside the union
    expect(reasoningStepForStatus("mystery").key).toBe("reasoning.working");
  });
});
