import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { CapabilityUseService } from "../capabilities/usage.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import {
  LinearIssueActionService,
  type LinearIssueActionAdapter,
  type LinearIssueCommentAdapterInput,
  type LinearIssueStateAdapterInput,
  type LinearIssueUpdateAdapterInput,
} from "./issue-actions.js";

class FakeLinearIssueActionAdapter implements LinearIssueActionAdapter {
  comments: LinearIssueCommentAdapterInput[] = [];
  updates: LinearIssueUpdateAdapterInput[] = [];
  states: LinearIssueStateAdapterInput[] = [];

  async commentIssue(
    input: LinearIssueCommentAdapterInput,
  ): Promise<{ id: string; url: string; status: string }> {
    this.comments.push(input);
    return {
      id: "comment_123",
      url: `https://linear.app/serium/issue/${input.identifier}#comment_123`,
      status: "created",
    };
  }

  async updateIssue(
    input: LinearIssueUpdateAdapterInput,
  ): Promise<{ id: string; url: string; status: string }> {
    this.updates.push(input);
    return {
      id: "update_123",
      url: `https://linear.app/serium/issue/${input.identifier}`,
      status: "updated",
    };
  }

  async setIssueState(
    input: LinearIssueStateAdapterInput,
  ): Promise<{ id: string; url: string; status: string }> {
    this.states.push(input);
    return {
      id: "state_123",
      url: `https://linear.app/serium/issue/${input.identifier}`,
      status: input.state,
    };
  }
}

describe("LinearIssueActionService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-linear-actions-"));
    await initWorkspace({ root: dir, organizationName: "Linear Actions Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("comments through the comment_on_issues policy path and records action evidence", async () => {
    const config = defaultConfig("agency");
    const adapter = new FakeLinearIssueActionAdapter();
    const result = await new LinearIssueActionService(dir, {
      config,
      adapter,
      capabilities: new CapabilityUseService(dir, { config }),
    }).comment({
      identifier: "ser-38",
      issueUrl:
        "https://linear.app/serium/issue/SER-38/implement-linear-issue-commentupdate-through-capability",
      agent: "project_manager",
      body: "Run started with BureauOS evidence.",
      runId: "run_123",
    });

    expect(result.status).toBe("completed");
    expect(result.action).toBe("comment");
    expect(result.capability.policy.action).toBe("comment_on_issues");
    expect(adapter.comments).toEqual([
      {
        identifier: "SER-38",
        body: "Run started with BureauOS evidence.",
      },
    ]);
    expect(result.artifact?.type).toBe("linear-issue-action-report");
    expect(result.artifact?.linear_identifier).toBe("SER-38");
    expect(result.artifact?.source_work_item_id).toBe("SER-38");

    const written = await new ArtifactStore(dir).read(result.artifact!.id);
    expect(written?.body).toContain("Actor: project_manager");
    expect(written?.body).toContain("Action: comment");
    expect(written?.body).toContain("Target: linear://issue/SER-38");
    expect(written?.body).toContain("Run started with BureauOS evidence.");
    expect(written?.body).toContain(result.capability.artifact.id);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("linear.issue.comment");
    expect(audit).toContain("linear://issue/SER-38");
    expect(audit).toContain(result.artifact!.id);
  });

  it("updates issue fields through the safe issue-update policy path", async () => {
    const config = defaultConfig("agency");
    const adapter = new FakeLinearIssueActionAdapter();
    const result = await new LinearIssueActionService(dir, {
      config,
      adapter,
      capabilities: new CapabilityUseService(dir, { config }),
    }).updateIssue({
      identifier: "SER-38",
      agent: "project_manager",
      title: "Implement Linear issue comment/update through capability boundary",
      labels: ["Feature", "Linear"],
    });

    expect(result.status).toBe("completed");
    expect(result.action).toBe("update_issues");
    expect(result.capability.policy.action).toBe("comment_on_issues");
    expect(adapter.updates).toEqual([
      {
        identifier: "SER-38",
        title: "Implement Linear issue comment/update through capability boundary",
        labels: ["Feature", "Linear"],
      },
    ]);

    const written = await new ArtifactStore(dir).read(result.artifact!.id);
    expect(written?.record.linear_action).toBe("update_issues");
    expect(written?.body).toContain("Updated fields: title, labels");
  });

  it("sets issue state through the same policy gate and audit surface", async () => {
    const config = defaultConfig("agency");
    const adapter = new FakeLinearIssueActionAdapter();
    const result = await new LinearIssueActionService(dir, {
      config,
      adapter,
      capabilities: new CapabilityUseService(dir, { config }),
    }).setIssueState({
      identifier: "SER-38",
      agent: "supreme_coordinator",
      state: "Done",
    });

    expect(result.status).toBe("completed");
    expect(result.action).toBe("set_issue_state");
    expect(result.capability.policy.action).toBe("comment_on_issues");
    expect(adapter.states).toEqual([{ identifier: "SER-38", state: "Done" }]);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("linear.issue.set_state");
    expect(audit).toContain(result.artifact!.id);
  });

  it("blocks comments before adapter calls when issue comments are disabled", async () => {
    const config = defaultConfig("agency");
    config.autonomy.comment_on_issues = false;
    const adapter = new FakeLinearIssueActionAdapter();
    const result = await new LinearIssueActionService(dir, {
      config,
      adapter,
      capabilities: new CapabilityUseService(dir, { config }),
    }).comment({
      identifier: "SER-38",
      agent: "project_manager",
      body: "This should not be sent.",
    });

    expect(result.status).toBe("blocked");
    expect(result.capability.policy.action).toBe("comment_on_issues");
    expect(adapter.comments).toEqual([]);
    expect(result.artifact).toBeUndefined();

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("capability.use.blocked");
    expect(audit).toContain("linear://issue/SER-38");
  });
});
