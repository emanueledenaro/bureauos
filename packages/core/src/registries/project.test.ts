import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "./project.js";
import { initWorkspace } from "../init/initializer.js";

describe("ProjectRegistry", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-projects-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates and reads a project", async () => {
    const r = new ProjectRegistry(dir);
    const p = await r.create({
      name: "Website Redesign",
      clientId: "client_abc",
      repository: "github.com/owner/web",
      stack: "Next.js",
    });
    expect(p.id).toMatch(/^project_/);
    const got = await r.get(p.slug);
    expect(got?.name).toBe("Website Redesign");
    expect(got?.client_id).toBe("client_abc");

    const ownership = await r.getOwnership(p.slug);
    expect(ownership).toMatchObject({
      project_id: p.id,
      manager_agent_id: "project_manager",
      escalation_agent_id: "supreme_coordinator",
      status: "active",
    });
    expect(ownership?.assigned_agents).toEqual(
      expect.arrayContaining(["project_manager", "development", "qa"]),
    );
    const ownershipDoc = await readFile(
      join(dir, ".bureauos", "memory", "projects", p.slug, "OWNERSHIP.md"),
      "utf8",
    );
    expect(ownershipDoc).toContain("Project Manager owns project memory");
  });

  it("lists projects for a given client", async () => {
    const r = new ProjectRegistry(dir);
    await r.create({ name: "P1", clientId: "client_a" });
    await r.create({ name: "P2", clientId: "client_a" });
    await r.create({ name: "P3", clientId: "client_b" });
    const a = await r.listForClient("client_a");
    expect(a.length).toBe(2);
  });

  it("updates per-project manager ownership", async () => {
    const r = new ProjectRegistry(dir);
    const p = await r.create({ name: "Mobile App", clientId: "client_mobile" });

    const updated = await r.updateOwnership(p.slug, {
      managerAgentId: "project_manager_mobile",
      managerRole: "Mobile Delivery PM",
      teamId: "team_mobile_delivery",
      assignedAgents: ["product", "development", "qa"],
    });

    expect(updated).toMatchObject({
      project_id: p.id,
      manager_agent_id: "project_manager_mobile",
      manager_role: "Mobile Delivery PM",
      team_id: "team_mobile_delivery",
    });
    expect(updated.assigned_agents[0]).toBe("project_manager_mobile");
    expect(updated.assigned_agents).toEqual(
      expect.arrayContaining(["product", "development", "qa"]),
    );

    const ownership = await r.listOwnership();
    expect(ownership.map((item) => item.manager_agent_id)).toContain("project_manager_mobile");
  });
});
