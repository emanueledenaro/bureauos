import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientRegistry } from "./client.js";
import { OpportunityRegistry } from "./opportunity.js";
import { ProjectRegistry } from "./project.js";
import { fileExists } from "./base.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";

describe("ClientRegistry", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-clients-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a client and reads it back", async () => {
    const r = new ClientRegistry(dir);
    const c = await r.create({ name: "Acme Co.", industry: "fintech" });
    expect(c.id).toMatch(/^client_/);
    expect(c.slug).toBe("acme-co");
    const got = await r.get("acme-co");
    expect(got?.name).toBe("Acme Co.");
    expect(got?.industry).toBe("fintech");
  });

  it("lists clients", async () => {
    const r = new ClientRegistry(dir);
    await r.create({ name: "Alpha" });
    await r.create({ name: "Beta" });
    const all = await r.list();
    expect(all.length).toBe(2);
  });

  it("hides archived clients from operational lists by default", async () => {
    const r = new ClientRegistry(dir);
    await r.create({ name: "Canonical Client" });
    await r.create({ name: "Polluted Duplicate" });
    await r.update("polluted-duplicate", { status: "archived" });

    await expect(r.list()).resolves.toMatchObject([{ name: "Canonical Client" }]);
    await expect(r.list({ includeArchived: true })).resolves.toHaveLength(2);
  });

  it("refuses duplicate slugs", async () => {
    const r = new ClientRegistry(dir);
    await r.create({ name: "Same Name" });
    await expect(r.create({ name: "Same Name" })).rejects.toThrow(/already exists/);
  });

  it("updates a client", async () => {
    const r = new ClientRegistry(dir);
    await r.create({ name: "Gamma" });
    const updated = await r.update("gamma", { status: "active" });
    expect(updated.status).toBe("active");
  });

  it("keeps the stable id and lookup slug when the display name is renamed (SER-45)", async () => {
    const r = new ClientRegistry(dir);
    const created = await r.create({ name: "Renamable Co.", industry: "saas" });
    const renamed = await r.update("renamable-co", { name: "Renamed Co." });
    // The display field changed...
    expect(renamed.name).toBe("Renamed Co.");
    // ...but the canonical id and the lookup slug are unchanged, so links and
    // memory paths keyed on them never break.
    expect(renamed.id).toBe(created.id);
    expect(renamed.slug).toBe(created.slug);
    const got = await r.get("renamable-co");
    expect(got?.id).toBe(created.id);
    expect(got?.name).toBe("Renamed Co.");
  });

  it("does not lose concurrent updates to distinct fields (SER-187)", async () => {
    const r = new ClientRegistry(dir);
    await r.create({ name: "Delta" });
    // Fire overlapping updates, each patching a different field of the same
    // record. Without serialization each call reads the same base and the last
    // writer would clobber the others; with `withFileLock` all changes survive.
    await Promise.all([
      r.update("delta", { status: "active" }),
      r.update("delta", { industry: "fintech" }),
      r.update("delta", { name: "Delta Renamed" }),
    ]);
    const got = await r.get("delta");
    expect(got?.status).toBe("active");
    expect(got?.industry).toBe("fintech");
    expect(got?.name).toBe("Delta Renamed");
  });

  it("deletes a client and cascade-deletes only its own projects and opportunities", async () => {
    const clients = new ClientRegistry(dir);
    const projects = new ProjectRegistry(dir);
    const opportunities = new OpportunityRegistry(dir);

    const target = await clients.create({ name: "Doomed Co." });
    const keep = await clients.create({ name: "Survivor Co." });

    // Two projects + two opportunities for the doomed client...
    const targetProject = await projects.create({ name: "Doomed Site", clientId: target.id });
    await projects.create({ name: "Doomed App", clientId: target.id });
    const targetOpp = await opportunities.create({
      title: "Doomed Opp",
      source: "test",
      clientId: target.id,
    });
    await opportunities.create({ title: "Doomed Opp 2", source: "test", clientId: target.id });
    // ...and one project + one opportunity for an unrelated client that must survive.
    const keepProject = await projects.create({ name: "Survivor Site", clientId: keep.id });
    const keepOpp = await opportunities.create({
      title: "Survivor Opp",
      source: "test",
      clientId: keep.id,
    });

    const summary = await clients.deleteClient("doomed-co");

    expect(summary.deleted).toBe(true);
    expect(summary.client).toMatchObject({ id: target.id, slug: "doomed-co" });
    expect(summary.projects).toHaveLength(2);
    expect(summary.projects).toContain(targetProject.id);
    expect(summary.opportunities).toHaveLength(2);
    expect(summary.opportunities).toContain(targetOpp.id);

    // The client directory is gone and it no longer lists.
    await expect(clients.get("doomed-co")).resolves.toBeUndefined();
    await expect(
      fileExists(join(dir, ".bureauos", "memory", "clients", "doomed-co")),
    ).resolves.toBe(false);

    // Its dependents are gone, scoped strictly by client_id.
    await expect(projects.listForClient(target.id)).resolves.toEqual([]);
    await expect(opportunities.listForClient(target.id)).resolves.toEqual([]);

    // The unrelated client and its records are untouched.
    await expect(clients.get("survivor-co")).resolves.toMatchObject({ id: keep.id });
    await expect(projects.get(keepProject.slug)).resolves.toMatchObject({ id: keepProject.id });
    await expect(opportunities.get(keepOpp.id)).resolves.toMatchObject({ id: keepOpp.id });

    // The deletion is audited.
    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("client.deleted");
    expect(audit).toContain(target.id);
  });

  it("returns a not-found result instead of throwing when the client is missing", async () => {
    const clients = new ClientRegistry(dir);
    const summary = await clients.deleteClient("does-not-exist");
    expect(summary).toEqual({
      deleted: false,
      reason: "not_found",
      projects: [],
      opportunities: [],
    });
    // A no-op delete writes no client.deleted audit event.
    const audit = await readFile(workspacePaths(dir).auditLog, "utf8").catch(() => "");
    expect(audit).not.toContain("client.deleted");
  });

  it("resolves a client by slug or by display name", async () => {
    const clients = new ClientRegistry(dir);
    const created = await clients.create({ name: "Pizzeria Aurora" });
    await expect(clients.resolve("pizzeria-aurora")).resolves.toMatchObject({ id: created.id });
    await expect(clients.resolve("Pizzeria Aurora")).resolves.toMatchObject({ id: created.id });
    await expect(clients.resolve("  PIZZERIA  AURORA. ")).resolves.toMatchObject({
      id: created.id,
    });
    await expect(clients.resolve("Unknown Brand")).resolves.toBeUndefined();
  });
});
