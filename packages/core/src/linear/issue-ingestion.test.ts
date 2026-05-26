import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { CapabilityUseService } from "../capabilities/usage.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { LinearIssueIngestionService } from "./issue-ingestion.js";

describe("LinearIssueIngestionService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-linear-ingestion-"));
    await initWorkspace({ root: dir, organizationName: "Linear Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("checks Linear read capability and writes a ready scope artifact", async () => {
    const config = defaultConfig("agency");
    const result = await new LinearIssueIngestionService(dir, {
      config,
      capabilities: new CapabilityUseService(dir, { config }),
    }).ingest({
      issue: {
        identifier: "SER-62",
        title: "Wire Codex runtime adapter to development agent execution",
        description:
          "Acceptance criteria:\n- Development Agent calls Codex runtime.\n- Runtime output is stored as artifacts.",
        url: "https://linear.app/serium/issue/SER-62/wire-codex-runtime-adapter",
        labels: ["Feature"],
        projectId: "bureauos-project",
        teamKey: "SER",
      },
      projectId: "bureauos",
      clientId: "internal",
      runId: "run_123",
    });

    expect(result.status).toBe("ready");
    expect(result.capability.status).toBe("allowed");
    expect(result.scope?.triggerSource).toBe("linear://issue/SER-62");
    expect(result.artifact?.type).toBe("project-dispatch-packet");

    const written = await new ArtifactStore(dir).read(result.artifact!.id);
    expect(written?.body).toContain("SER-62");
    expect(written?.body).toContain("Development Agent calls Codex runtime");
    expect(written?.body).toContain("Readiness: ready");
  });

  it("writes a clarification artifact instead of allowing ambiguous work", async () => {
    const config = defaultConfig("agency");
    const result = await new LinearIssueIngestionService(dir, {
      config,
      capabilities: new CapabilityUseService(dir, { config }),
    }).ingest({
      issue: {
        identifier: "SER-200",
        title: "Make BureauOS better",
        description: "Improve the whole thing.",
        url: "https://linear.app/serium/issue/SER-200/make-bureauos-better",
        labels: ["Feature"],
        projectId: "bureauos-project",
        teamKey: "SER",
      },
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.scope?.blockers).toContain("missing acceptance criteria");
    expect(result.artifact?.type).toBe("project-dispatch-packet");

    const written = await new ArtifactStore(dir).read(result.artifact!.id);
    expect(written?.body).toContain("Readiness: needs_clarification");
    expect(written?.body).toContain("missing acceptance criteria");
  });

  it("blocks before scope mapping when Linear reads are disallowed by policy", async () => {
    const config = defaultConfig("agency");
    config.autonomy.observe_signals = false;
    const result = await new LinearIssueIngestionService(dir, {
      config,
      capabilities: new CapabilityUseService(dir, { config }),
    }).ingest({
      issue: {
        identifier: "SER-62",
        title: "Wire Codex runtime adapter to development agent execution",
        description:
          "Acceptance criteria:\n- Development Agent calls Codex runtime.\n- Runtime output is stored as artifacts.",
        url: "https://linear.app/serium/issue/SER-62/wire-codex-runtime-adapter",
        labels: ["Feature"],
        projectId: "bureauos-project",
        teamKey: "SER",
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.capability.status).toBe("blocked");
    expect(result.scope).toBeUndefined();
    expect(result.artifact).toBeUndefined();
  });
});
