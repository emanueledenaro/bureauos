import { mkdtemp, rm } from "node:fs/promises";
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
  });

  it("lists projects for a given client", async () => {
    const r = new ProjectRegistry(dir);
    await r.create({ name: "P1", clientId: "client_a" });
    await r.create({ name: "P2", clientId: "client_a" });
    await r.create({ name: "P3", clientId: "client_b" });
    const a = await r.listForClient("client_a");
    expect(a.length).toBe(2);
  });
});
