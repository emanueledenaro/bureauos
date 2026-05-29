#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, initWorkspace, startApiServer } from "../packages/core/dist/index.js";

const PROMPTS = {
  greeting: "ciao",
  saveClient: "abbiamo un cliente si chiama Pizzeria Amodeo lo puoi salvare?",
  projectScope:
    "pizzeria amodeo vorrebbe un sito basico di html e css per una pizza specifica la margherita",
  projectStatus: "il sito di amodeo che ho richiesto?",
  companyStatus: "come siamo messi?",
};

const FORBIDDEN_VISIBLE_PATTERNS = [
  /Non ho creato/i,
  /ho solo letto/i,
  /system prompt/i,
  /developer prompt/i,
  /scratchpad/i,
  /reasoning/i,
  /raw provider payload/i,
  /<analysis/i,
  /Restaurant Lead/i,
  /New Client Lead/i,
];

function usage() {
  return [
    "Usage:",
    "  pnpm qa:coordinator",
    "  node scripts/qa-coordinator-prompt-matrix.mjs [--base http://127.0.0.1:3737] [--skip-project-scope] [--json]",
    "",
    "Default mode creates a temporary BureauOS workspace and API server, then runs the full prompt matrix.",
    "--base runs against an existing local API and can mutate it unless --skip-project-scope is passed.",
  ].join("\n");
}

function parseArgs(argv) {
  const out = { json: false, skipProjectScope: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (arg === "--skip-project-scope") {
      out.skipProjectScope = true;
      continue;
    }
    if (arg === "--base") {
      const value = argv[index + 1];
      if (!value) throw new Error("--base requires a URL");
      out.base = value.replace(/\/+$/, "");
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function requestJson(base, path, init) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
  return JSON.parse(text);
}

async function counts(base) {
  const [clients, projects, opportunities, approvals] = await Promise.all([
    requestJson(base, "/clients"),
    requestJson(base, "/projects"),
    requestJson(base, "/opportunities"),
    requestJson(base, "/approvals"),
  ]);
  return {
    clients: clients.length,
    projects: projects.length,
    opportunities: opportunities.length,
    approvals: approvals.length,
  };
}

function sameCounts(a, b) {
  return (
    a.clients === b.clients &&
    a.projects === b.projects &&
    a.opportunities === b.opportunities &&
    a.approvals === b.approvals
  );
}

async function postCoordinatorMessage(base, prompt) {
  return requestJson(base, "/coordinator/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: prompt }),
  });
}

function visibleText(result) {
  return result?.coordinatorMessage?.text ?? "";
}

function forbiddenMatches(text) {
  return FORBIDDEN_VISIBLE_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) =>
    pattern.toString(),
  );
}

function addCheck(checks, ok, label, details = "") {
  checks.push({ ok, label, details });
}

async function runPrompt(base, id, prompt) {
  const before = await counts(base);
  const result = await postCoordinatorMessage(base, prompt);
  const after = await counts(base);
  const text = visibleText(result);
  return {
    id,
    prompt,
    before,
    after,
    mode: result.mode,
    provider: result.provider?.reason ?? result.provider?.status ?? "unknown",
    text,
    forbiddenMatches: forbiddenMatches(text),
    meta: result.coordinatorMessage?.meta ?? {},
  };
}

async function runMatrix(base, options) {
  const prompts = [
    ["greeting", PROMPTS.greeting],
    ["save_client", PROMPTS.saveClient],
    ...(!options.skipProjectScope ? [["project_scope", PROMPTS.projectScope]] : []),
    ["project_status", PROMPTS.projectStatus],
    ["company_status", PROMPTS.companyStatus],
  ];

  const results = [];
  for (const [id, prompt] of prompts) {
    results.push(await runPrompt(base, id, prompt));
  }

  const [clients, projects, approvals] = await Promise.all([
    requestJson(base, "/clients"),
    requestJson(base, "/projects"),
    requestJson(base, "/approvals"),
  ]);

  const checks = [];
  for (const result of results) {
    addCheck(
      checks,
      result.forbiddenMatches.length === 0,
      `${result.id}: visible reply has no forbidden filler/leakage`,
      result.forbiddenMatches.join(", "),
    );
  }

  const greeting = results.find((item) => item.id === "greeting");
  addCheck(
    checks,
    Boolean(greeting?.text.includes("Ciao Emanuele")),
    "greeting: concise operator reply",
    greeting?.text,
  );

  const saveClient = results.find((item) => item.id === "save_client");
  addCheck(
    checks,
    Boolean(saveClient && saveClient.after.projects === saveClient.before.projects),
    "save_client: no project created",
  );
  addCheck(
    checks,
    Boolean(saveClient && saveClient.after.opportunities === saveClient.before.opportunities),
    "save_client: no opportunity created",
  );
  addCheck(
    checks,
    Boolean(saveClient && saveClient.after.approvals === saveClient.before.approvals),
    "save_client: no approval created",
  );

  const projectScope = results.find((item) => item.id === "project_scope");
  if (projectScope) {
    addCheck(
      checks,
      projectScope.mode === "intake",
      "project_scope: routed through intake",
      projectScope.mode,
    );
    addCheck(
      checks,
      projectScope.text.includes("Pizzeria Amodeo"),
      "project_scope: preserves named client",
      projectScope.text,
    );
    addCheck(
      checks,
      projectScope.after.approvals === projectScope.before.approvals,
      "project_scope: no routine approval gate",
    );
  }

  const projectStatus = results.find((item) => item.id === "project_status");
  addCheck(
    checks,
    Boolean(projectStatus && sameCounts(projectStatus.before, projectStatus.after)),
    "project_status: answer-only, no registry mutation",
  );
  addCheck(
    checks,
    Boolean(projectStatus?.text.includes("Pizzeria Amodeo Website")),
    "project_status: resolves existing Amodeo project",
    projectStatus?.text,
  );

  const companyStatus = results.find((item) => item.id === "company_status");
  addCheck(
    checks,
    Boolean(companyStatus && sameCounts(companyStatus.before, companyStatus.after)),
    "company_status: answer-only, no registry mutation",
  );
  addCheck(
    checks,
    Boolean(companyStatus?.text.includes("Siamo così")),
    "company_status: registry-backed company pulse",
    companyStatus?.text,
  );

  const clientNames = clients.map((client) => client.name);
  addCheck(
    checks,
    clientNames.includes("Pizzeria Amodeo"),
    "registry: canonical Pizzeria Amodeo client is active",
    clientNames.join(", "),
  );
  addCheck(
    checks,
    !clientNames.some((name) => /Restaurant Lead|New Client Lead|Lo Puoi Salvare/i.test(name)),
    "registry: no active generic or polluted client",
    clientNames.join(", "),
  );
  addCheck(checks, approvals.length === 0, "registry: no pending routine approval gates");

  return {
    ok: checks.every((check) => check.ok),
    generatedAt: new Date().toISOString(),
    base,
    prompts: results,
    finalState: {
      clients: clientNames,
      projects: projects.map((project) => ({
        name: project.name,
        status: project.status,
      })),
      approvals: approvals.length,
    },
    checks,
  };
}

function printReport(report) {
  console.log(`Coordinator prompt matrix: ${report.ok ? "PASS" : "FAIL"}`);
  console.log(`API: ${report.base}`);
  console.log("");
  for (const item of report.prompts) {
    console.log(`Prompt [${item.id}]: ${item.prompt}`);
    console.log(`Reply: ${item.text.replace(/\n/g, " | ")}`);
    console.log(
      `Counts: ${JSON.stringify(item.before)} -> ${JSON.stringify(item.after)} | mode=${item.mode} provider=${item.provider}`,
    );
    console.log("");
  }
  console.log("Checks:");
  for (const check of report.checks) {
    console.log(
      `- ${check.ok ? "PASS" : "FAIL"} ${check.label}${check.details ? `: ${check.details}` : ""}`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let server;
  let base = options.base;
  if (!base) {
    const root = await mkdtemp(join(tmpdir(), "bureauos-coordinator-qa-"));
    await initWorkspace({
      root,
      organizationName: "Coordinator QA Agency",
      preset: "freelancer",
    });
    server = await startApiServer({ workspaceRoot: root, config: defaultConfig("freelancer") });
    base = server.url;
  }

  try {
    const report = await runMatrix(base, options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
    if (!report.ok) process.exitCode = 1;
  } finally {
    await server?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
