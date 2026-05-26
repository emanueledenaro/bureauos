import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { readDoc } from "../registries/base.js";
import { ClientRegistry } from "../registries/client.js";
import { ProjectRegistry } from "../registries/project.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";
import { appendDailyNote } from "./daily.js";
import { recordDecision } from "./decisions.js";

describe("memory write-back", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-memory-writeback-"));
    await initWorkspace({ root: dir, organizationName: "Memory Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends daily notes inside the requested local-date section", async () => {
    const date = new Date("2026-05-26T10:00:00.000Z");
    const path = await appendDailyNote(dir, "Runs", "Generated daily operating report.", date);
    const content = await readFile(path, "utf8");

    expect(path.endsWith("2026-05-26.md")).toBe(true);
    expect(content).toContain("## Runs\n\n- Generated daily operating report.");
    expect(content).not.toContain("- (Runs) Generated daily operating report.");
  });

  it("records global decisions with run, client, project, daily, and audit cross-links", async () => {
    const client = await new ClientRegistry(dir).create({ name: "Pizzeria Aurora" });
    const project = await new ProjectRegistry(dir).create({
      name: "Pizzeria Aurora Website",
      clientId: client.id,
    });
    const paths = workspacePaths(dir);
    const audit = new AuditLog(paths.auditLog);
    const run = await new RunEngine(dir, {
      audit,
      artifacts: new ArtifactStore(dir),
      policy: new PolicyEngine(defaultConfig("agency"), new ApprovalRegistry(dir)),
    }).start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "memory-writeback-test",
      scope: "Prepare launch decision",
      clientId: client.id,
      projectId: project.id,
    });

    const result = await recordDecision(dir, {
      actor: "supreme_coordinator",
      what: "Use a single-page launch scope for Pizzeria Aurora",
      why: "The client needs a small validated delivery before upsell.",
      runId: run.id,
      affects: [client.id, project.id],
      date: new Date("2026-05-26T11:00:00.000Z"),
    });

    expect(result.globalPath).toBe(paths.decisionsLog);
    expect(result.clientPath).toBe(join(paths.clientsDir, client.slug, "DECISIONS.md"));
    expect(result.projectPath).toBe(join(paths.projectsDir, project.slug, "DECISIONS.md"));
    expect(result.runPath).toBe(join(paths.runsDir, `${run.id}.md`));
    expect(result.dailyPath?.endsWith("2026-05-26.md")).toBe(true);

    const globalDecisions = await readFile(paths.decisionsLog, "utf8");
    expect(globalDecisions).toContain(`- Decision ID: ${result.id}`);
    expect(globalDecisions).toContain(`- Run: ${run.id}`);
    expect(globalDecisions).toContain(`- Client: ${client.id}`);
    expect(globalDecisions).toContain(`- Project: ${project.id}`);

    const runDoc = await readDoc<RunRecord>(join(paths.runsDir, `${run.id}.md`));
    expect(runDoc.front.decisions).toContain(result.id);
    expect(runDoc.body).toContain(`${result.id}: Use a single-page launch scope`);

    const clientDecisions = await readFile(
      join(paths.clientsDir, client.slug, "DECISIONS.md"),
      "utf8",
    );
    const projectDecisions = await readFile(
      join(paths.projectsDir, project.slug, "DECISIONS.md"),
      "utf8",
    );
    expect(clientDecisions).toContain("Use a single-page launch scope");
    expect(projectDecisions).toContain("Use a single-page launch scope");

    const daily = await readFile(join(paths.dailyDir, "2026-05-26.md"), "utf8");
    expect(daily).toContain(`${result.id}: Use a single-page launch scope`);

    const auditLog = await readFile(paths.auditLog, "utf8");
    expect(auditLog).toContain("memory.decision_recorded");
    expect(auditLog).toContain(result.id);
  });

  it("keeps project-scoped decision writes inside the allowed memory boundary", async () => {
    const clients = new ClientRegistry(dir);
    const alphaClient = await clients.create({ name: "Alpha Client" });
    const betaClient = await clients.create({ name: "Beta Client" });
    const projects = new ProjectRegistry(dir);
    const alpha = await projects.create({ name: "Alpha Web", clientId: alphaClient.id });
    const beta = await projects.create({ name: "Beta Web", clientId: betaClient.id });
    const paths = workspacePaths(dir);

    const scoped = await recordDecision(dir, {
      actor: "project_manager",
      what: "Keep Alpha launch scope narrow",
      why: "Project-scoped decision should not edit global memory.",
      clientId: alphaClient.id,
      projectId: alpha.id,
      memoryScope: { clientId: alphaClient.id, projectId: alpha.id },
      date: new Date("2026-05-26T12:00:00.000Z"),
    });

    expect(scoped.globalPath).toBeUndefined();
    expect(scoped.dailyPath).toBeUndefined();
    await expect(readFile(paths.decisionsLog, "utf8")).resolves.not.toContain(
      "Keep Alpha launch scope narrow",
    );
    await expect(
      readFile(join(paths.projectsDir, alpha.slug, "DECISIONS.md"), "utf8"),
    ).resolves.toContain("Keep Alpha launch scope narrow");

    await expect(
      recordDecision(dir, {
        actor: "project_manager",
        what: "Write Beta decision from Alpha scope",
        why: "This should be blocked by memory scope.",
        clientId: betaClient.id,
        projectId: beta.id,
        memoryScope: { clientId: alphaClient.id, projectId: alpha.id },
      }),
    ).rejects.toThrow(/scope denied/);

    await expect(readFile(paths.decisionsLog, "utf8")).resolves.not.toContain(
      "Write Beta decision from Alpha scope",
    );
    await expect(
      readFile(join(paths.projectsDir, beta.slug, "DECISIONS.md"), "utf8"),
    ).resolves.not.toContain("Write Beta decision from Alpha scope");
  });
});
