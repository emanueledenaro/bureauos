import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientRegistry } from "./client.js";
import { initWorkspace } from "../init/initializer.js";

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
});
