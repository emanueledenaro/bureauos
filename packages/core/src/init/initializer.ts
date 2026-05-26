import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { dirname } from "node:path";
import { defaultConfig } from "../config/loader.js";
import type { BureauConfig, Preset } from "../config/schema.js";
import { workspacePaths, type WorkspacePaths } from "../paths.js";
import { AuditLog } from "../audit/log.js";
import {
  rootMemory,
  companyMemory,
  policies,
  emptyIndex,
  emptyDailyNote,
  defaultConfigYaml,
  executiveReport,
} from "./templates.js";

export interface InitOptions {
  root: string;
  preset?: Preset;
  organizationName?: string;
  force?: boolean;
}

export interface InitResult {
  workspaceDir: string;
  configFile: string;
  filesCreated: string[];
  config: BureauConfig;
}

export class InitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitError";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function writeFileFresh(path: string, content: string, created: string[]): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
  created.push(path);
}

/**
 * Create a BureauOS workspace at `options.root`.
 *
 * The function is idempotent only when `force` is true. By default it refuses
 * to overwrite an existing workspace.
 *
 * The workspace shape follows `docs/bos-kernel-infrastructure.md` "Runtime
 * Data Layout". After init the workspace contains: memory tree, daily note,
 * empty registries, audit log, approval folders, and a first executive
 * report. No external action is taken.
 */
export async function initWorkspace(options: InitOptions): Promise<InitResult> {
  const paths = workspacePaths(options.root);

  if ((await exists(paths.workspaceDir)) && !options.force) {
    throw new InitError(
      `workspace already exists at ${paths.workspaceDir}; pass force: true to overwrite`,
    );
  }

  const preset: Preset = options.preset ?? "freelancer";
  const orgName = options.organizationName ?? "Untitled BureauOS Workspace";
  const config: BureauConfig = {
    ...defaultConfig(preset),
    organization: { name: orgName },
  };

  const isoDate = new Date().toISOString().slice(0, 10);
  const created: string[] = [];

  await ensureScaffold(paths);

  await writeFileFresh(paths.configFile, defaultConfigYaml(config, orgName), created);
  await writeFileFresh(paths.rootMemory, rootMemory(orgName, isoDate), created);
  await writeFileFresh(paths.companyMemory, companyMemory(orgName, isoDate), created);
  await writeFileFresh(paths.policiesMemory, policies(config), created);

  const indexFiles: ReadonlyArray<readonly [string, string, string]> = [
    [
      paths.clientsIndex,
      "Clients Index",
      "List of active clients. Profiles live in `clients/<slug>/CLIENT.md`.",
    ],
    [
      paths.projectsIndex,
      "Projects Index",
      "List of active projects. Project memory lives in `projects/<slug>/`.",
    ],
    [paths.decisionsLog, "Decisions", "Durable decision records. Append-only by convention."],
    [
      paths.activeWorkLog,
      "Active Work",
      "Snapshot of work in progress. Updated by the coordinator.",
    ],
    [paths.risksLog, "Risks", "Open risks at company, client, and project level."],
    [paths.brandMemory, "Brand", "Owner and company positioning."],
    [paths.offersMemory, "Offers", "Active offers and packages."],
    [paths.channelsMemory, "Channels", "Visibility and distribution channels."],
    [paths.leadsMemory, "Leads", "Lead pipeline."],
    [paths.campaignsMemory, "Campaigns", "Marketing and ad campaigns."],
    [paths.conversionNotes, "Conversion Notes", "Funnel observations and objections."],
    [paths.pricingMemory, "Pricing", "Pricing logic and margin notes."],
    [paths.proposalsMemory, "Proposals", "Proposal pipeline status."],
    [paths.complianceMemory, "Compliance", "Legal, privacy, and public-claim boundaries."],
    [paths.approvalsMemory, "Approvals", "Action-sensitive approval records."],
    [paths.publicClaimsMemory, "Public Claims", "Claims that are allowed or forbidden."],
  ];
  for (const [filePath, title, hint] of indexFiles) {
    await writeFileFresh(filePath, emptyIndex(title, hint), created);
  }

  const dailyNotePath = `${paths.dailyDir}/${isoDate}.md`;
  await writeFileFresh(dailyNotePath, emptyDailyNote(isoDate), created);

  const firstReportPath = `${paths.artifactsDir}/executive-report-${isoDate}.md`;
  await writeFileFresh(firstReportPath, executiveReport(orgName, isoDate), created);

  const audit = new AuditLog(paths.auditLog);
  await audit.append({
    actor: "bureau init",
    action: "workspace.init",
    target: paths.workspaceDir,
    result: "ok",
  });
  created.push(paths.auditLog);

  return {
    workspaceDir: paths.workspaceDir,
    configFile: paths.configFile,
    filesCreated: created,
    config,
  };
}

async function ensureScaffold(paths: WorkspacePaths): Promise<void> {
  const dirs = [
    paths.workspaceDir,
    paths.memoryDir,
    paths.dailyDir,
    paths.coordinatorDir,
    paths.clientsDir,
    paths.projectsDir,
    paths.opportunitiesDir,
    paths.runsDir,
    paths.artifactsDir,
    paths.indexesDir,
    paths.auditDir,
    paths.notificationsDir,
    paths.notificationsInboxDir,
    paths.daemonDir,
    paths.approvalsPendingDir,
    paths.approvalsResolvedDir,
  ];
  for (const d of dirs) {
    await ensureDir(d);
  }
}
