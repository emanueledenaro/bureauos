import { AuditLog } from "../audit/log.js";
import { defaultConfig } from "../config/loader.js";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry, type DeletedClientSummary } from "../registries/client.js";
import {
  CoordinatorIntakeService,
  type CoordinatorIntakeInput,
  type CoordinatorIntakeResult,
} from "./intake.js";
import type { CoordinatorImplementedToolAction, CoordinatorToolPlan } from "./tool-planning.js";

export type CoordinatorToolExecutionSource =
  | "provider_plan"
  | "safety_fallback"
  | "api_endpoint"
  | "cli";

export interface CoordinatorToolMeta {
  name: CoordinatorImplementedToolAction;
  source: CoordinatorToolExecutionSource;
  confidence?: number;
}

export interface CoordinatorToolRuntimeDeps {
  config?: BureauConfig;
  audit?: AuditLog;
  intake?: CoordinatorIntakeService;
  clients?: ClientRegistry;
}

export interface CoordinatorCreateIntakeToolInput extends CoordinatorIntakeInput {
  plan?: CoordinatorToolPlan;
  toolSource: CoordinatorToolExecutionSource;
}

export interface CoordinatorCreateIntakeToolExecution {
  result: CoordinatorIntakeResult;
  tool: CoordinatorToolMeta;
}

export interface CoordinatorDeleteClientToolInput {
  /** Target client, given as a slug or a display name (resolved either way). */
  target: string;
  /**
   * Explicit owner confirmation. The deletion runs ONLY when this is `true`;
   * otherwise the runtime returns a "confirmation required" result and removes
   * nothing (deleting data is a require-approval action in BureauOS policy).
   */
  confirmed: boolean;
  plan?: CoordinatorToolPlan;
  toolSource: CoordinatorToolExecutionSource;
}

export type CoordinatorDeleteClientToolStatus = "deleted" | "confirmation_required" | "not_found";

export interface CoordinatorDeleteClientToolExecution {
  status: CoordinatorDeleteClientToolStatus;
  /** Cascade summary, present only when a client was actually deleted. */
  result?: DeletedClientSummary;
  /** The resolved target (id/slug/name) when the client exists. */
  client?: { id: string; slug: string; name: string };
  /** Owner-facing one-line explanation of the outcome (Italian). */
  message: string;
  tool: CoordinatorToolMeta;
}

export class CoordinatorToolRuntime {
  private readonly config: BureauConfig;
  private readonly audit: AuditLog;
  private readonly intake: CoordinatorIntakeService;
  private readonly clients: ClientRegistry;

  constructor(
    private readonly workspaceRoot: string,
    deps: CoordinatorToolRuntimeDeps = {},
  ) {
    this.config = deps.config ?? defaultConfig("freelancer");
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.intake =
      deps.intake ?? new CoordinatorIntakeService(workspaceRoot, { config: this.config });
    // Share the runtime's audit log so registry-level (`client.deleted`) and
    // tool-level (`coordinator.tool.executed`) events land in the same log.
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot, { audit: this.audit });
  }

  async executeCreateIntake(
    input: CoordinatorCreateIntakeToolInput,
  ): Promise<CoordinatorCreateIntakeToolExecution> {
    if (input.plan && input.plan.action !== "create_intake") {
      throw new Error("coordinator create_intake runtime requires a create_intake plan");
    }

    const result = await this.intake.process({
      message: input.message,
      source: input.source,
      clientName: input.clientName ?? input.plan?.clientName,
      industry: input.industry ?? input.plan?.industry,
      projectName: input.projectName,
      expectedValue: input.expectedValue,
      expectedMargin: input.expectedMargin,
      attachments: input.attachments,
    });
    await this.recordToolExecution({ tool: "create_intake", target: result.run.id });

    return {
      result,
      tool: coordinatorToolMeta("create_intake", input.toolSource, input.plan),
    };
  }

  /**
   * Executive, destructive delete-client tool. Resolves the target client by
   * slug or name, then:
   *  - refuses (status `confirmation_required`, deletes nothing) unless the plan
   *    carries an explicit `confirmed: true` — deleting data is a
   *    require-approval action in BureauOS policy;
   *  - returns status `not_found` (no audit, no error) when the client does not
   *    exist, so the tool is safe to retry;
   *  - otherwise cascade-deletes the client and its own projects/opportunities
   *    and audits `coordinator.tool.executed` with capability
   *    `coordinator_tool.delete_client`.
   *
   * A refusal is itself audited (`coordinator.tool.rejected`) so a blocked
   * destructive attempt is traceable.
   */
  async executeDeleteClient(
    input: CoordinatorDeleteClientToolInput,
  ): Promise<CoordinatorDeleteClientToolExecution> {
    if (input.plan && input.plan.action !== "delete_client") {
      throw new Error("coordinator delete_client runtime requires a delete_client plan");
    }

    const target = input.target.trim();
    const tool = coordinatorToolMeta("delete_client", input.toolSource, input.plan);
    if (!target) {
      await this.recordRejectedToolPlan("delete_client_missing_target");
      return {
        status: "confirmation_required",
        message:
          "Per eliminare un cliente indicami quale (nome o slug). Nessun dato è stato toccato.",
        tool,
      };
    }

    const client = await this.clients.resolve(target);
    if (!client) {
      // Not found is a clean, idempotent-friendly outcome, not an error.
      return {
        status: "not_found",
        message: `Non trovo nessun cliente "${target}" nel registry. Non ho eliminato nulla.`,
        tool,
      };
    }

    const clientRef = { id: client.id, slug: client.slug, name: client.name };

    if (input.confirmed !== true) {
      // Destructive action gate: never delete without explicit confirmation.
      await this.recordRejectedToolPlan(`delete_client_unconfirmed:${client.id}`);
      return {
        status: "confirmation_required",
        client: clientRef,
        message: `Eliminare il cliente "${client.name}" cancella in modo permanente la sua scheda e tutti i suoi progetti e opportunità collegati. Conferma esplicitamente per procedere.`,
        tool,
      };
    }

    const result = await this.clients.deleteClient(client.slug);
    if (!result.deleted) {
      // Lost a race with another deleter between resolve and delete.
      return {
        status: "not_found",
        client: clientRef,
        message: `Il cliente "${client.name}" non risulta più presente. Non ho eliminato nulla.`,
        tool,
      };
    }

    await this.recordToolExecution({ tool: "delete_client", target: client.id });
    return {
      status: "deleted",
      result,
      client: clientRef,
      message: `Ho eliminato il cliente "${client.name}" e in cascata ${result.projects.length} progetto/i e ${result.opportunities.length} opportunità collegati.`,
      tool,
    };
  }

  async recordToolExecution(input: {
    tool: CoordinatorImplementedToolAction;
    target?: string;
  }): Promise<void> {
    await this.audit.append({
      actor: "supreme_coordinator",
      action: "coordinator.tool.executed",
      capability: `coordinator_tool.${input.tool}`,
      ...(input.target ? { target: input.target } : {}),
      result: "ok",
    });
  }

  async recordRejectedToolPlan(reason: string): Promise<void> {
    await this.audit.append({
      actor: "supreme_coordinator",
      action: "coordinator.tool.rejected",
      capability: "coordinator_tool.invalid_plan",
      target: reason,
      result: "ok",
    });
  }
}

export function coordinatorToolMeta(
  name: CoordinatorImplementedToolAction,
  source: CoordinatorToolExecutionSource,
  plan?: CoordinatorToolPlan,
): CoordinatorToolMeta {
  return {
    name,
    source,
    ...(plan?.confidence !== undefined ? { confidence: plan.confidence } : {}),
  };
}
