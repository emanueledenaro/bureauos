import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { ProjectRegistry } from "../registries/project.js";

/**
 * Phase 5 memory isolation acceptance.
 *
 * Project memory must be physically isolated per project (separate folder
 * tree under .bureauos/memory/projects/<slug>/) and client memory must be
 * physically isolated per client. A project manager looking at one project
 * folder must not see another project's files.
 */
describe("memory isolation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-iso-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("each client gets its own folder with private files", async () => {
    const reg = new ClientRegistry(dir);
    const acme = await reg.create({ name: "Acme Co" });
    const globex = await reg.create({ name: "Globex" });
    const paths = workspacePaths(dir);

    const acmeProfile = await readFile(join(paths.clientsDir, "acme-co", "CLIENT.md"), "utf8");
    const globexProfile = await readFile(join(paths.clientsDir, "globex", "CLIENT.md"), "utf8");
    expect(acmeProfile).toContain(acme.id);
    expect(globexProfile).toContain(globex.id);
    expect(acmeProfile).not.toContain(globex.id);
    expect(globexProfile).not.toContain(acme.id);

    // Per-client side files exist and are scoped to that client.
    const acmeRevenue = await readFile(join(paths.clientsDir, "acme-co", "REVENUE.md"), "utf8");
    expect(acmeRevenue).toContain(acme.id);
    expect(acmeRevenue).not.toContain(globex.id);
  });

  it("each project gets its own folder; another project cannot see it via listForClient", async () => {
    const clients = new ClientRegistry(dir);
    const a = await clients.create({ name: "Alpha" });
    const b = await clients.create({ name: "Beta" });

    const projects = new ProjectRegistry(dir);
    await projects.create({ name: "Alpha Web", clientId: a.id });
    await projects.create({ name: "Alpha Mobile", clientId: a.id });
    await projects.create({ name: "Beta Web", clientId: b.id });

    const alpha = await projects.listForClient(a.id);
    const beta = await projects.listForClient(b.id);

    expect(alpha.map((p) => p.slug).sort()).toEqual(["alpha-mobile", "alpha-web"]);
    expect(beta.map((p) => p.slug).sort()).toEqual(["beta-web"]);
    // Cross-leakage check
    expect(alpha.some((p) => p.client_id === b.id)).toBe(false);
    expect(beta.some((p) => p.client_id === a.id)).toBe(false);
  });

  it("project files include the project id in front-matter, never the other project's id", async () => {
    const projects = new ProjectRegistry(dir);
    const one = await projects.create({ name: "Site One", clientId: "client_x" });
    const two = await projects.create({ name: "Site Two", clientId: "client_y" });
    const paths = workspacePaths(dir);

    const oneArch = await readFile(join(paths.projectsDir, "site-one", "ARCHITECTURE.md"), "utf8");
    const twoArch = await readFile(join(paths.projectsDir, "site-two", "ARCHITECTURE.md"), "utf8");
    expect(oneArch).toContain(one.id);
    expect(twoArch).toContain(two.id);
    expect(oneArch).not.toContain(two.id);
    expect(twoArch).not.toContain(one.id);
  });
});
