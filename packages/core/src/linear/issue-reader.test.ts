import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { CapabilityUseService } from "../capabilities/usage.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { RunEngine } from "../runs/engine.js";
import {
  LinearIssueReaderService,
  type LinearIssueAdapter,
  type LinearIssueListInput,
} from "./issue-reader.js";
import type { LinearIssueScopeInput } from "./work-scope.js";

class FakeLinearIssueAdapter implements LinearIssueAdapter {
  readCalls: string[] = [];
  listCalls: LinearIssueListInput[] = [];

  constructor(private readonly issues: readonly LinearIssueScopeInput[]) {}

  async readIssue(identifier: string): Promise<LinearIssueScopeInput | undefined> {
    this.readCalls.push(identifier);
    return this.issues.find((issue) => issue.identifier.toUpperCase() === identifier.toUpperCase());
  }

  async listIssues(input: LinearIssueListInput): Promise<readonly LinearIssueScopeInput[]> {
    this.listCalls.push(input);
    return this.issues.filter((issue) => {
      if (input.teamKey && issue.teamKey !== input.teamKey) return false;
      if (input.projectId && issue.projectId !== input.projectId) return false;
      if (input.query && !`${issue.identifier} ${issue.title}`.includes(input.query)) return false;
      return true;
    });
  }
}

function issue(input: Partial<LinearIssueScopeInput> = {}): LinearIssueScopeInput {
  return {
    identifier: "SER-35",
    title: "Implement Linear issue read/list through capability boundary",
    description:
      "Acceptance criteria:\n- Reads require linear.read_issues capability check.\n- Result can seed BureauOS run scope.",
    url: "https://linear.app/serium/issue/SER-35/implement-linear-issue-readlist-through-capability-boundary",
    labels: ["Feature"],
    projectId: "bureauos-project",
    teamKey: "SER",
    ...input,
  };
}

describe("LinearIssueReaderService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-linear-reader-"));
    await initWorkspace({ root: dir, organizationName: "Linear Reader Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("checks linear.read_issues before reading an issue and returns run-ready scope", async () => {
    const config = defaultConfig("agency");
    const adapter = new FakeLinearIssueAdapter([issue({ identifier: "ser-35" })]);
    const service = new LinearIssueReaderService(dir, {
      config,
      adapter,
      capabilities: new CapabilityUseService(dir, { config }),
    });

    const result = await service.readIssue({
      identifier: "ser-35",
      agent: "project_manager",
    });

    expect(result.status).toBe("ready");
    expect(adapter.readCalls).toEqual(["SER-35"]);
    expect(result.capability.status).toBe("allowed");
    expect(result.target).toBe("linear://issue/SER-35");
    expect(result.issue?.identifier).toBe("SER-35");
    expect(result.scope?.triggerSource).toBe("linear://issue/SER-35");
    expect(result.scope?.sourceWorkItem).toEqual({
      type: "linear_issue",
      identifier: "SER-35",
      url: "https://linear.app/serium/issue/SER-35/implement-linear-issue-readlist-through-capability-boundary",
    });

    const written = await new ArtifactStore(dir).read(result.capability.artifact.id);
    expect(written?.body).toContain("Agent: project_manager");
    expect(written?.body).toContain("Target: linear://issue/SER-35");
    expect(written?.body).toContain("Capability: linear");
    expect(written?.body).toContain("Action: read_issues");
  });

  it("seeds RunEngine with source issue metadata from the read scope", async () => {
    const config = defaultConfig("agency");
    const adapter = new FakeLinearIssueAdapter([issue()]);
    const service = new LinearIssueReaderService(dir, {
      config,
      adapter,
      capabilities: new CapabilityUseService(dir, { config }),
    });
    const read = await service.readIssue({ identifier: "SER-35" });
    expect(read.scope).toBeDefined();

    const approvals = new ApprovalRegistry(dir);
    const artifacts = new ArtifactStore(dir);
    const engine = new RunEngine(dir, {
      artifacts,
      audit: new AuditLog(workspacePaths(dir).auditLog),
      policy: new PolicyEngine(config, approvals),
    });
    const run = await engine.start({
      type: read.scope!.runType,
      triggerType: read.scope!.triggerType,
      triggerSource: read.scope!.triggerSource,
      scope: read.scope!.scope,
      sourceWorkItem: read.scope!.sourceWorkItem,
    });

    expect(run.linear_identifier).toBe("SER-35");
    expect(run.source_work_item_url).toContain("https://linear.app/serium/issue/SER-35");
    expect(run.scope).toContain("Reads require linear.read_issues capability check");
  });

  it("lists issues through the same capability boundary", async () => {
    const config = defaultConfig("agency");
    const adapter = new FakeLinearIssueAdapter([
      issue(),
      issue({
        identifier: "SER-99",
        title: "Draft unrelated docs",
        labels: ["Docs"],
        teamKey: "DOC",
      }),
    ]);
    const service = new LinearIssueReaderService(dir, {
      config,
      adapter,
      capabilities: new CapabilityUseService(dir, { config }),
    });

    const result = await service.listIssues({
      agent: "supreme_coordinator",
      teamKey: "SER",
      projectId: "bureauos-project",
      query: "Linear issue",
      limit: 10,
    });

    expect(result.status).toBe("listed");
    expect(result.target).toBe(
      "linear://issues?team=SER&project=bureauos-project&query=Linear+issue&limit=10",
    );
    expect(result.issues.map((item) => item.identifier)).toEqual(["SER-35"]);
    expect(result.scopes[0]?.triggerSource).toBe("linear://issue/SER-35");
    expect(adapter.listCalls).toEqual([
      {
        teamKey: "SER",
        projectId: "bureauos-project",
        query: "Linear issue",
        limit: 10,
      },
    ]);
  });

  it("blocks before adapter calls when Linear reads are disallowed", async () => {
    const config = defaultConfig("agency");
    config.autonomy.observe_signals = false;
    const adapter = new FakeLinearIssueAdapter([issue()]);
    const result = await new LinearIssueReaderService(dir, {
      config,
      adapter,
      capabilities: new CapabilityUseService(dir, { config }),
    }).readIssue({ identifier: "SER-35", agent: "project_manager" });

    expect(result.status).toBe("blocked");
    expect(result.capability.policy.action).toBe("observe_signals");
    expect(adapter.readCalls).toEqual([]);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("capability.use.blocked");
    expect(audit).toContain("linear://issue/SER-35");
  });

  it("returns not_found after an allowed read when the adapter has no issue", async () => {
    const config = defaultConfig("agency");
    const adapter = new FakeLinearIssueAdapter([]);
    const result = await new LinearIssueReaderService(dir, {
      config,
      adapter,
      capabilities: new CapabilityUseService(dir, { config }),
    }).readIssue({ identifier: "SER-404" });

    expect(result.status).toBe("not_found");
    expect(result.capability.status).toBe("allowed");
    expect(adapter.readCalls).toEqual(["SER-404"]);
    expect(result.scope).toBeUndefined();
  });
});
