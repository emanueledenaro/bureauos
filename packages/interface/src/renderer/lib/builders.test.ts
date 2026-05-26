import { describe, expect, it } from "vitest";
import type { ArtifactRecord } from "./api";
import {
  buildLinkedWorkItems,
  buildPortfolioLanes,
  normalizeRepositoryReference,
} from "./builders";
import type { DashboardState } from "./types";

const emptyDashboardState: DashboardState = {
  clients: [],
  projects: [],
  projectOwnership: [],
  opportunities: [],
  approvals: [],
  resolvedApprovals: [],
  notifications: [],
  runs: [],
  agents: [],
  capabilities: [],
  providers: [],
  providerConnectors: [],
  artifacts: [],
  audit: [],
  loading: false,
};

describe("normalizeRepositoryReference", () => {
  it("normalizes supported GitHub repository formats", () => {
    expect(normalizeRepositoryReference("https://github.com/Owner/Repo.git")).toBe("owner/repo");
    expect(normalizeRepositoryReference("git@github.com:Owner/Repo.git")).toBe("owner/repo");
    expect(normalizeRepositoryReference("Owner/Repo")).toBe("owner/repo");
  });
});

describe("buildPortfolioLanes", () => {
  it("uses project ownership agents and GitHub signal artifacts for project cards", () => {
    const signal: ArtifactRecord = {
      id: "art_signal",
      type: "github-signal-report",
      status: "submitted",
      repository: "owner/repo",
      pull_requests_count: 2,
      pull_request_refs: ["#42 open Add checkout flow"],
      pull_request_urls: ["https://github.com/owner/repo/pull/42"],
      checks_count: 6,
      failing_checks_count: 1,
      stale_issues_count: 0,
      stale_pull_requests_count: 0,
      created: "2026-05-26T10:00:00.000Z",
    };

    const lanes = buildPortfolioLanes({
      ...emptyDashboardState,
      clients: [
        {
          id: "client_1",
          slug: "client",
          name: "Client",
          status: "active",
          industry: "Services",
        },
      ],
      projects: [
        {
          id: "project_1",
          slug: "project",
          name: "Project",
          client_id: "client_1",
          status: "in_progress",
          repository: "https://github.com/owner/repo",
          stack: "Next.js",
        },
      ],
      projectOwnership: [
        {
          id: "ownership_1",
          project_id: "project_1",
          project_slug: "project",
          client_id: "client_1",
          manager_agent_id: "project_manager",
          manager_role: "Project Manager",
          team_id: "team_1",
          status: "active",
          assigned_agents: ["project_manager", "development", "qa", "security"],
          escalation_agent_id: "supreme_coordinator",
        },
      ],
      artifacts: [signal],
    });

    const stream = lanes[0]?.streams[0];
    expect(stream?.badges).toEqual(["PM", "D", "Q", "S"]);
    expect(stream?.delivery).toMatchObject({
      repository: "owner/repo",
      label: "1 failing",
      detail: "PR 2 · CI 6 · stale 0",
      tone: "danger",
    });
    expect(stream?.delivery?.pullRequests).toEqual([
      {
        label: "#42",
        title: "#42 open Add checkout flow",
        url: "https://github.com/owner/repo/pull/42",
      },
    ]);
  });

  it("shows honest repository states when project data is incomplete", () => {
    const lanes = buildPortfolioLanes({
      ...emptyDashboardState,
      clients: [
        {
          id: "client_1",
          slug: "client",
          name: "Client",
          status: "active",
          industry: "Services",
        },
      ],
      projects: [
        {
          id: "project_1",
          slug: "project",
          name: "Project",
          client_id: "client_1",
          status: "intake",
          repository: "",
          stack: "",
        },
        {
          id: "project_2",
          slug: "linked",
          name: "Linked Project",
          client_id: "client_1",
          status: "intake",
          repository: "owner/repo",
          stack: "",
        },
      ],
    });

    expect(lanes[0]?.streams[0]?.delivery).toMatchObject({
      label: "No repo",
      detail: "Project memory only",
      tone: "warning",
    });
    expect(lanes[0]?.streams[1]?.delivery).toMatchObject({
      label: "Repo linked",
      detail: "GitHub sync not run",
      tone: "neutral",
    });
  });
});

describe("buildLinkedWorkItems", () => {
  it("links runs to source Linear issues and GitHub pull requests when present", () => {
    const items = buildLinkedWorkItems({
      ...emptyDashboardState,
      runs: [
        {
          id: "run_linked",
          type: "feature",
          status: "completed",
          scope: "Implement checkout",
          created: "2026-05-26T10:00:00.000Z",
          source_work_item_type: "linear_issue",
          source_work_item_id: "SER-89",
          source_work_item_url: "https://linear.app/serium/issue/SER-89/work-dashboard",
          project_id: "project_1",
          artifacts: ["art_signal"],
        },
      ],
      projects: [
        {
          id: "project_1",
          slug: "project",
          name: "Project",
          client_id: "client_1",
          status: "in_progress",
          repository: "https://github.com/owner/repo",
          stack: "Next.js",
        },
      ],
      artifacts: [
        {
          id: "art_signal",
          type: "github-signal-report",
          status: "submitted",
          run_id: "run_linked",
          repository: "owner/repo",
          pull_request_refs: ["#42 open Add checkout flow"],
          pull_request_urls: ["https://github.com/owner/repo/pull/42"],
          pull_requests_count: 1,
          checks_count: 4,
          failing_checks_count: 0,
          stale_issues_count: 0,
          stale_pull_requests_count: 0,
          head_sha: "abc123def4567890",
          created: "2026-05-26T10:05:00.000Z",
        },
      ],
    });

    expect(items[0]).toMatchObject({
      runId: "run_linked",
      issueLabel: "SER-89",
      issueUrl: "https://linear.app/serium/issue/SER-89/work-dashboard",
      issueState: "linked",
      prState: "linked",
      prDetail: "PR 1 · CI 4 · failing 0",
      repository: "owner/repo",
      commit: "abc123def456",
    });
    expect(items[0]?.pullRequests).toEqual([
      {
        label: "#42",
        title: "#42 open Add checkout flow",
        url: "https://github.com/owner/repo/pull/42",
      },
    ]);
  });

  it("flags delivery runs with missing external work links", () => {
    const items = buildLinkedWorkItems({
      ...emptyDashboardState,
      runs: [
        {
          id: "run_unlinked",
          type: "feature",
          status: "in_progress",
          scope: "Implement unscoped work",
          created: "2026-05-26T10:00:00.000Z",
        },
      ],
    });

    expect(items[0]).toMatchObject({
      issueLabel: "No issue",
      issueState: "missing",
      issueDetail: "Run has no Linear source issue",
      prState: "missing",
      prDetail: "No PR linked for delivery run",
    });
  });

  it("flags stale GitHub work linked to a run", () => {
    const items = buildLinkedWorkItems({
      ...emptyDashboardState,
      runs: [
        {
          id: "run_stale",
          type: "bug",
          status: "blocked",
          scope: "Fix flaky checkout",
          created: "2026-05-26T10:00:00.000Z",
          linear_identifier: "SER-90",
          linear_url: "https://linear.app/serium/issue/SER-90/local-alerts",
          project_id: "project_1",
        },
      ],
      projects: [
        {
          id: "project_1",
          slug: "project",
          name: "Project",
          client_id: "client_1",
          status: "blocked",
          repository: "owner/repo",
          stack: "Next.js",
        },
      ],
      artifacts: [
        {
          id: "art_stale",
          type: "github-signal-report",
          status: "submitted",
          repository: "owner/repo",
          pull_request_refs: ["#7 open Fix checkout"],
          pull_request_urls: ["https://github.com/owner/repo/pull/7"],
          pull_requests_count: 1,
          checks_count: 2,
          failing_checks_count: 1,
          stale_issues_count: 1,
          stale_pull_requests_count: 1,
          created: "2026-05-26T10:05:00.000Z",
        },
      ],
    });

    expect(items[0]).toMatchObject({
      issueState: "linked",
      prState: "stale",
      staleCount: 2,
      failingChecks: 1,
      prDetail: "2 stale GitHub items",
    });
  });
});
