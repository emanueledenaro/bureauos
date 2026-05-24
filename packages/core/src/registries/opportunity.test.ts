import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpportunityRegistry } from "./opportunity.js";
import { initWorkspace } from "../init/initializer.js";

describe("OpportunityRegistry", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-opps-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates an opportunity with sensible defaults", async () => {
    const r = new OpportunityRegistry(dir);
    const o = await r.create({
      title: "Mobile App for New Client",
      source: "owner_intake",
      clientId: "client_1",
      expectedValue: 148000,
    });
    expect(o.id).toMatch(/^opp_/);
    expect(o.status).toBe("intake");
    expect(o.expected_value).toBe(148000);
    expect(o.approval_required).toContain("final_price");
  });

  it("updates an opportunity status", async () => {
    const r = new OpportunityRegistry(dir);
    const o = await r.create({ title: "X", source: "lead", clientId: "client_1" });
    const updated = await r.update(o.id, { status: "qualified" });
    expect(updated.status).toBe("qualified");
  });
});
