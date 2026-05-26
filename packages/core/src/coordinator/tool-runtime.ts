import { AuditLog } from "../audit/log.js";
import { defaultConfig } from "../config/loader.js";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";
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
}

export interface CoordinatorCreateIntakeToolInput extends CoordinatorIntakeInput {
  plan?: CoordinatorToolPlan;
  toolSource: CoordinatorToolExecutionSource;
}

export interface CoordinatorCreateIntakeToolExecution {
  result: CoordinatorIntakeResult;
  tool: CoordinatorToolMeta;
}

export class CoordinatorToolRuntime {
  private readonly config: BureauConfig;
  private readonly audit: AuditLog;
  private readonly intake: CoordinatorIntakeService;

  constructor(
    private readonly workspaceRoot: string,
    deps: CoordinatorToolRuntimeDeps = {},
  ) {
    this.config = deps.config ?? defaultConfig("freelancer");
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.intake =
      deps.intake ?? new CoordinatorIntakeService(workspaceRoot, { config: this.config });
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
