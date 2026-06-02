import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ProjectRegistry } from "../registries/project.js";
import { CoordinatorToolRuntime } from "./tool-runtime.js";

describe("CoordinatorToolRuntime", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-tool-runtime-"));
    await initWorkspace({ root: dir, organizationName: "Tool Runtime Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("executes create_intake through a typed tool path and records audit evidence", async () => {
    const runtime = new CoordinatorToolRuntime(dir, { config: defaultConfig("agency") });

    const execution = await runtime.executeCreateIntake({
      message: "Ho parlato con Pizzeria Aurora: vuole sito con prenotazioni.",
      clientName: "Pizzeria Aurora",
      source: "cli",
      toolSource: "cli",
    });

    expect(execution.tool).toEqual({
      name: "create_intake",
      source: "cli",
    });
    expect(execution.result.client.slug).toBe("pizzeria-aurora");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("coordinator_tool.create_intake");
  });

  it("rejects non-create_intake plans before mutating the workspace", async () => {
    const runtime = new CoordinatorToolRuntime(dir, { config: defaultConfig("agency") });

    await expect(
      runtime.executeCreateIntake({
        message: "Salva Pizzeria Aurora come cliente.",
        source: "cli",
        toolSource: "cli",
        plan: {
          action: "save_client",
          clientName: "Pizzeria Aurora",
        },
      }),
    ).rejects.toThrow("requires a create_intake plan");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).not.toContain("coordinator_tool.create_intake");
  });

  it("refuses delete_client without explicit confirmation and deletes nothing", async () => {
    const clients = new ClientRegistry(dir);
    const projects = new ProjectRegistry(dir);
    const client = await clients.create({ name: "Pizzeria Aurora" });
    const project = await projects.create({ name: "Aurora Site", clientId: client.id });

    const runtime = new CoordinatorToolRuntime(dir, { config: defaultConfig("agency") });
    const execution = await runtime.executeDeleteClient({
      target: "Pizzeria Aurora",
      confirmed: false,
      toolSource: "provider_plan",
      plan: { action: "delete_client", clientName: "Pizzeria Aurora" },
    });

    expect(execution.status).toBe("confirmation_required");
    expect(execution.client).toMatchObject({ id: client.id, slug: "pizzeria-aurora" });
    // Nothing was removed.
    await expect(clients.get("pizzeria-aurora")).resolves.toMatchObject({ id: client.id });
    await expect(projects.get(project.slug)).resolves.toMatchObject({ id: project.id });

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    // The refusal is audited, but no execution/deletion event is written.
    expect(audit).toContain("coordinator.tool.rejected");
    expect(audit).not.toContain("coordinator_tool.delete_client");
    expect(audit).not.toContain("client.deleted");
  });

  it("deletes a client (resolved by name) with cascade and audit once confirmed", async () => {
    const clients = new ClientRegistry(dir);
    const projects = new ProjectRegistry(dir);
    const opportunities = new OpportunityRegistry(dir);
    const client = await clients.create({ name: "Pizzeria Aurora" });
    await projects.create({ name: "Aurora Site", clientId: client.id });
    await opportunities.create({ title: "Aurora Opp", source: "test", clientId: client.id });

    const runtime = new CoordinatorToolRuntime(dir, { config: defaultConfig("agency") });
    const execution = await runtime.executeDeleteClient({
      target: "Pizzeria Aurora",
      confirmed: true,
      toolSource: "provider_plan",
      plan: { action: "delete_client", clientName: "Pizzeria Aurora", confirmed: true },
    });

    expect(execution.status).toBe("deleted");
    expect(execution.tool).toMatchObject({ name: "delete_client", source: "provider_plan" });
    expect(execution.result?.projects).toHaveLength(1);
    expect(execution.result?.opportunities).toHaveLength(1);

    // The client and its dependents are gone.
    await expect(clients.get("pizzeria-aurora")).resolves.toBeUndefined();
    await expect(projects.listForClient(client.id)).resolves.toEqual([]);
    await expect(opportunities.listForClient(client.id)).resolves.toEqual([]);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("coordinator_tool.delete_client");
    expect(audit).toContain("client.deleted");
  });

  it("returns not_found for an unknown delete_client target without deleting or erroring", async () => {
    const runtime = new CoordinatorToolRuntime(dir, { config: defaultConfig("agency") });
    const execution = await runtime.executeDeleteClient({
      target: "Nonexistent Brand",
      confirmed: true,
      toolSource: "cli",
    });

    expect(execution.status).toBe("not_found");
    const audit = await readFile(workspacePaths(dir).auditLog, "utf8").catch(() => "");
    expect(audit).not.toContain("coordinator_tool.delete_client");
    expect(audit).not.toContain("client.deleted");
  });

  it("rejects a non-delete_client plan passed to the delete runtime", async () => {
    const runtime = new CoordinatorToolRuntime(dir, { config: defaultConfig("agency") });
    await expect(
      runtime.executeDeleteClient({
        target: "Pizzeria Aurora",
        confirmed: true,
        toolSource: "cli",
        plan: { action: "save_client", clientName: "Pizzeria Aurora" },
      }),
    ).rejects.toThrow("requires a delete_client plan");
  });
});
