import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Octokit instance the mocked `@octokit/rest` constructor returns. Defined
// via vi.hoisted so it exists when the hoisted vi.mock factory runs.
const { fakeOctokit } = vi.hoisted(() => {
  return {
    fakeOctokit: {
      paginate: vi.fn(),
      issues: { listForRepo: vi.fn(), listLabelsForRepo: vi.fn() },
      pulls: { list: vi.fn() },
      checks: { listForRef: vi.fn() },
    },
  };
});

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => fakeOctokit),
}));

import { OctokitGitHubClient } from "./octokit-client.js";

describe("OctokitGitHubClient pagination (SER-228)", () => {
  beforeEach(() => {
    fakeOctokit.paginate.mockReset();
  });

  it("returns every issue across pages and excludes pull requests", async () => {
    // 150 real issues (> one 100-item page) plus a few PR-shaped items that
    // listForRepo also returns and must be filtered out.
    const issues = Array.from({ length: 150 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      html_url: `https://github.com/acme/web/issues/${i + 1}`,
      state: "open",
      labels: [],
      updated_at: "2026-01-01T00:00:00.000Z",
    }));
    const prItems = Array.from({ length: 5 }, (_, i) => ({
      number: 1000 + i,
      title: `PR ${i}`,
      html_url: `https://github.com/acme/web/pull/${1000 + i}`,
      state: "open",
      labels: [],
      updated_at: "2026-01-01T00:00:00.000Z",
      pull_request: { url: "x" },
    }));
    fakeOctokit.paginate.mockResolvedValue([...issues, ...prItems]);

    const client = new OctokitGitHubClient({ token: "t" });
    const result = await client.listIssues("acme", "web");

    // All 150 issues are returned (not capped at a single 100-item page) and
    // the PR-shaped items are excluded.
    expect(result).toHaveLength(150);
    expect(result.every((issue) => !issue.url.includes("/pull/"))).toBe(true);
    // The aggregation goes through octokit.paginate, not a single-page list.
    expect(fakeOctokit.paginate).toHaveBeenCalledWith(
      fakeOctokit.issues.listForRepo,
      expect.objectContaining({ owner: "acme", repo: "web", state: "open", per_page: 100 }),
    );
  });

  it("returns every pull request across pages", async () => {
    const pulls = Array.from({ length: 120 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      html_url: `https://github.com/acme/web/pull/${i + 1}`,
      state: "open",
      head: { ref: `feature/${i + 1}`, sha: "abc" },
      base: { ref: "main" },
      updated_at: "2026-01-01T00:00:00.000Z",
    }));
    fakeOctokit.paginate.mockResolvedValue(pulls);

    const client = new OctokitGitHubClient({ token: "t" });
    const result = await client.listPullRequests("acme", "web");

    expect(result).toHaveLength(120);
    expect(fakeOctokit.paginate).toHaveBeenCalledWith(
      fakeOctokit.pulls.list,
      expect.objectContaining({ owner: "acme", repo: "web", state: "open", per_page: 100 }),
    );
  });
});
