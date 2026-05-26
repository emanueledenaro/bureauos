import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { LocalNotificationCenter } from "./local.js";

describe("LocalNotificationCenter", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-notifications-"));
    await initWorkspace({ root: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("emits an owner notification when approval-gated work needs a decision", async () => {
    const approval = await new ApprovalRegistry(dir).request({
      action: "open_pull_requests",
      actor: "supreme_coordinator",
      target: "github.com/acme/web",
      scope: "SER-90 approval notification",
    });

    const notifications = await new LocalNotificationCenter(dir).list();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "approval_needed",
      title: "Approval needed: Open Pull Requests",
      severity: "warning",
      status: "unread",
      source_type: "approval",
      source_id: approval.id,
      target: "github.com/acme/web",
      dedupe_key: `approval:${approval.id}`,
    });
  });

  it("dedupes approval notifications by approval id", async () => {
    const approvals = new ApprovalRegistry(dir);
    const approval = await approvals.request({
      action: "deploy_production",
      actor: "release",
      target: "vercel://project/acme-web/production",
      scope: "Production deploy",
    });
    const center = new LocalNotificationCenter(dir);

    await center.notifyApprovalNeeded(approval);
    await center.notifyApprovalNeeded(approval);

    const notifications = await center.list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.dedupe_key).toBe(`approval:${approval.id}`);
    expect(notifications[0]?.severity).toBe("critical");
  });

  it("does not fail approval creation when notification delivery fails", async () => {
    const approvals = new ApprovalRegistry(dir, {
      notifications: {
        async notifyApprovalNeeded() {
          throw new Error("local notification bridge unavailable");
        },
      },
    });

    const approval = await approvals.request({
      action: "send_client_messages",
      actor: "account_lead",
      target: "client/acme",
      scope: "Client follow-up",
    });

    await expect(approvals.getPending(approval.id)).resolves.toMatchObject({
      id: approval.id,
      status: "pending",
    });
    await expect(new LocalNotificationCenter(dir).list()).resolves.toEqual([]);
  });
});
