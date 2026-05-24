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
});
