import { describe, expect, it } from "vitest";
import {
  coordinatorToolPromptCatalog,
  implementedCoordinatorToolNames,
  listCoordinatorMutationPathInventory,
  parseCoordinatorToolPlan,
} from "./tool-planning.js";

describe("coordinator tool planning contract", () => {
  it("inventories coordinator mutation paths by route class", () => {
    const inventory = listCoordinatorMutationPathInventory();
    const classes = new Set(inventory.map((item) => item.classification));

    expect(classes).toEqual(new Set(["agentic_tool_path", "safety_fallback"]));
    expect(inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "coordinator.chat.provider.save_client",
          classification: "agentic_tool_path",
          tool: "save_client",
        }),
        expect.objectContaining({
          id: "coordinator.chat.fallback.create_intake",
          classification: "safety_fallback",
          tool: "create_intake",
        }),
        expect.objectContaining({
          id: "api.post_coordinator_intake",
          classification: "agentic_tool_path",
          tool: "create_intake",
        }),
        expect.objectContaining({
          id: "cli.bureau_intake",
          classification: "agentic_tool_path",
          tool: "create_intake",
        }),
      ]),
    );
  });

  it("exposes only implemented tools as selectable runtime tools", () => {
    expect(implementedCoordinatorToolNames()).toEqual([
      "save_client",
      "create_intake",
      "list_clients",
      "delete_client",
      "answer",
    ]);
    expect(coordinatorToolPromptCatalog()).toContain("create_project");
    expect(coordinatorToolPromptCatalog()).toContain("planned, do not choose yet");
  });

  it("parses the destructive delete_client tool with its target and confirmation gate", () => {
    const unconfirmed = parseCoordinatorToolPlan(
      JSON.stringify({ action: "delete_client", clientName: "Pizzeria Aurora" }),
    );
    expect(unconfirmed).toMatchObject({ action: "delete_client", clientName: "Pizzeria Aurora" });
    // No confirmation flag => `confirmed` stays unset so the runtime gate fails closed.
    expect(unconfirmed?.confirmed).toBeUndefined();

    const confirmed = parseCoordinatorToolPlan(
      JSON.stringify({ action: "client.delete", clientSlug: "pizzeria-aurora", confirmed: true }),
    );
    expect(confirmed).toMatchObject({
      action: "delete_client",
      clientSlug: "pizzeria-aurora",
      confirmed: true,
    });

    // A non-true confirmation value must NOT confirm the deletion.
    const softNo = parseCoordinatorToolPlan(
      JSON.stringify({ action: "delete_client", clientName: "Acme", confirmed: "maybe" }),
    );
    expect(softNo?.confirmed).toBeUndefined();
  });

  it("parses and cleans provider-selected tool arguments", () => {
    const plan = parseCoordinatorToolPlan(
      JSON.stringify({
        action: "save_client",
        clientName: "Pizzeria Amodeo lo puoi salvare?",
        confidence: 2,
      }),
    );

    expect(plan).toEqual({
      action: "save_client",
      clientName: "Pizzeria Amodeo",
      confidence: 1,
    });
  });

  it("rejects unsupported provider-selected tools", () => {
    expect(
      parseCoordinatorToolPlan(JSON.stringify({ action: "wire_money", clientName: "Acme" })),
    ).toBeUndefined();
  });

  it("parses the dispatch_build flag for an owner build request", () => {
    // The owner wants software built for themselves now -> create_intake with
    // dispatch_build: true. Only a literal boolean true (or string "true") sets it.
    const built = parseCoordinatorToolPlan(
      JSON.stringify({
        action: "create_intake",
        projectName: "Pokeball",
        dispatch_build: true,
        confidence: 0.9,
      }),
    );
    expect(built).toMatchObject({ action: "create_intake", dispatch_build: true });

    const builtString = parseCoordinatorToolPlan(
      JSON.stringify({ action: "create_intake", dispatch_build: "true" }),
    );
    expect(builtString?.dispatch_build).toBe(true);
  });

  it("leaves dispatch_build unset for client-scoping intakes and non-build plans", () => {
    // Client-scoping intake ("the client wants a site") -> scope/propose first,
    // no build flag.
    const clientScope = parseCoordinatorToolPlan(
      JSON.stringify({ action: "create_intake", clientName: "Acme" }),
    );
    expect(clientScope?.dispatch_build).toBeUndefined();

    // A status answer is never a build.
    const status = parseCoordinatorToolPlan(
      JSON.stringify({ action: "answer", answer: "Ecco lo stato." }),
    );
    expect(status?.dispatch_build).toBeUndefined();

    // Fails closed for non-true values.
    const softNo = parseCoordinatorToolPlan(
      JSON.stringify({ action: "create_intake", dispatch_build: "maybe" }),
    );
    expect(softNo?.dispatch_build).toBeUndefined();
    const falseFlag = parseCoordinatorToolPlan(
      JSON.stringify({ action: "create_intake", dispatch_build: false }),
    );
    expect(falseFlag?.dispatch_build).toBeUndefined();
  });
});
