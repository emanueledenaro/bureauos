import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { defaultConfig } from "../config/loader.js";
import { CoordinatorIntakeService } from "../coordinator/intake.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ProjectDispatchService } from "./project-dispatch.js";

describe("ProjectDispatchService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-project-dispatch-"));
    await initWorkspace({ root: dir, organizationName: "Dispatch Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates project-scoped dispatch and handoff packets before running specialist agents", async () => {
    const intake = await new CoordinatorIntakeService(dir, {
      config: defaultConfig("agency"),
    }).process({
      clientName: "Pizzeria Aurora",
      message:
        "Oggi ho parlato con una pizzeria: vuole un sito con prenotazioni, identita, logo, posizione e contenuti.",
      source: "owner_chat",
    });

    const result = await new ProjectDispatchService(dir, {
      config: defaultConfig("agency"),
    }).dispatch({
      projectSlug: intake.project.slug,
      runType: "feature",
      scope: "Prepare dev-ready work for booking website MVP",
      briefing: "Create the first implementation-ready delivery packet.",
    });

    expect(result.project.id).toBe(intake.project.id);
    expect(result.client?.id).toBe(intake.client.id);
    expect(result.ownership).toMatchObject({
      project_id: intake.project.id,
      manager_agent_id: "project_manager",
      escalation_agent_id: "supreme_coordinator",
    });
    expect(result.pipeline).toEqual(["product", "ux", "development", "qa", "security", "reviewer"]);
    expect(result.packet.type).toBe("project-dispatch-packet");
    expect(result.handoffs).toHaveLength(6);
    expect(result.handoffs.map((handoff) => handoff.role)).toEqual(result.pipeline);
    expect(result.run.artifacts).toEqual(
      expect.arrayContaining([
        result.packet.id,
        ...result.handoffs.map((handoff) => handoff.artifact.id),
      ]),
    );

    const artifacts = await new ArtifactStore(dir).list({ run_id: result.run.id });
    expect(artifacts.map((artifact) => artifact.type)).toEqual(
      expect.arrayContaining([
        "project-dispatch-packet",
        "agent-handoff",
        "feature-spec",
        "design-spec",
        "technical-plan",
        "test-plan",
        "security-review",
        "pr-review",
      ]),
    );

    const packet = await new ArtifactStore(dir).read(result.packet.id);
    expect(packet?.body).toContain("Memory Boundary");
    expect(packet?.body).toContain("Allowed project memory");
    expect(packet?.body).toContain("Project Manager Ownership");
    expect(packet?.body).toContain("Manager agent: project_manager");
    expect(packet?.body).toContain("Source Artifacts");

    const runs = await readFile(
      join(workspacePaths(dir).projectsDir, intake.project.slug, "RUNS.md"),
      "utf8",
    );
    expect(runs).toContain(`Dispatch ${result.run.id}`);
    expect(runs).toContain("Project Manager: project_manager");
    expect(runs).toContain(result.packet.id);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("project.dispatch.completed");
  });
});
