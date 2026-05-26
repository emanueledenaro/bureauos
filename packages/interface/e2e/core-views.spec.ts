import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createInterfaceWorkspace, type InterfaceWorkspace } from "./interface-workspace.js";

const FORBIDDEN_RENDERER_PATTERNS = [
  /Restaurant Lead/i,
  /New Client Lead/i,
  /Demo Client/i,
  /Mock Client/i,
  /Fake Revenue/i,
  /Lorem ipsum/i,
];

const CORE_VIEWS = [
  { nav: "Home", expected: "Portfolio Operating Room" },
  { nav: "Coordinator", expected: "Supreme Coordinator" },
  { nav: "Clients", expected: "Clients" },
  { nav: "Delivery", expected: "Delivery" },
  { nav: "Approvals", expected: "Approvals" },
  { nav: "Reports", expected: "Reports" },
  { nav: "Memory", expected: "Memory" },
  { nav: "Settings", expected: "Settings" },
  { nav: "Growth", expected: "Growth" },
  { nav: "Revenue", expected: "Revenue" },
  { nav: "Agents", expected: "Agents" },
  { nav: "Inbox", expected: "Today" },
  { nav: "Goals", expected: "Goals" },
] as const;

const COMPACT_VIEWS = CORE_VIEWS;

for (const kind of ["empty", "seeded"] as const) {
  test.describe(`Operating Room ${kind} workspace`, () => {
    let workspace: InterfaceWorkspace;

    test.beforeAll(async () => {
      workspace = await createInterfaceWorkspace(kind);
    });

    test.afterAll(async () => {
      await workspace.close();
    });

    test("renders every core view on desktop without overflow or demo data", async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openWorkspace(page, workspace);

      for (const view of CORE_VIEWS) {
        await openDesktopView(page, view.nav);
        await expect(page.locator("main")).toContainText(view.expected);
        await expectNoFrameworkOverlay(page);
        await expectNoHorizontalOverflow(page);
        await expectNoForbiddenRendererData(page);
        await attachScreenshot(page, testInfo, `${kind}-${slug(view.nav)}-desktop`);
      }
    });

    test("renders every core view on phone without overflow or demo data", async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openWorkspace(page, workspace);

      for (const view of COMPACT_VIEWS) {
        await openCompactView(page, view.nav);
        await expect(page.locator("main")).toContainText(view.expected);
        await expectNoFrameworkOverlay(page);
        await expectNoHorizontalOverflow(page);
        await expectNoForbiddenRendererData(page);
        await attachScreenshot(page, testInfo, `${kind}-${slug(view.nav)}-phone`);
      }
    });

    test("renders every core view on tablet without overflow or demo data", async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await openWorkspace(page, workspace);

      for (const view of COMPACT_VIEWS) {
        await openCompactView(page, view.nav);
        await expect(page.locator("main")).toContainText(view.expected);
        await expectNoFrameworkOverlay(page);
        await expectNoHorizontalOverflow(page);
        await expectNoForbiddenRendererData(page);
        await attachScreenshot(page, testInfo, `${kind}-${slug(view.nav)}-tablet`);
      }
    });
  });
}

test.describe("Operating Room memory browser", () => {
  let workspace: InterfaceWorkspace;

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
  });

  test("renders searchable memory entries and selected entry detail", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, workspace);
    await openDesktopView(page, "Memory");

    await expect(page.locator("main")).toContainText("Local Memory Browser");
    await expect(page.locator("main")).toContainText("Entry Detail");
    await expect(page.locator("main")).toContainText("clients/acme-labs/CLIENT.md");
    await page.getByRole("button", { name: /clients\/acme-labs\/CLIENT\.md/i }).click();
    await expect(page.locator("main")).toContainText("Seed client for Operating Room");
    await attachScreenshot(page, testInfo, "seeded-memory-browser-detail");
  });
});

test.describe("Operating Room portfolio modes", () => {
  let workspace: InterfaceWorkspace;

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
  });

  test("renders workload gantt kanban tabs and stable filters from local state", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, workspace);
    await openDesktopView(page, "Home");

    const main = page.locator("main");
    await main.getByRole("tab", { name: /Workload/i }).click();
    await expect(main).toContainText("assigned record");
    await expect(main).toContainText("Development");
    await expectNoHorizontalOverflow(page);

    await main.getByRole("tab", { name: /Gantt/i }).click();
    await expect(main).toContainText("Timeline evidence");
    await expect(main).toContainText("Acme Website Refresh");
    await expectNoHorizontalOverflow(page);

    await main.getByRole("tab", { name: /Kanban/i }).click();
    await expect(main).toContainText("In Progress");
    await expect(main).toContainText("Feature");
    await expectNoHorizontalOverflow(page);

    await main.getByLabel("Status filter").click();
    await page.getByRole("option", { name: "Completed" }).click();
    await expect(main).toContainText("Completed");
    await expectNoHorizontalOverflow(page);

    await main.getByRole("button", { name: "Reset", exact: true }).click();
    await main.getByRole("button", { name: /Active risk only/i }).click();
    await expect(main).toContainText("Blocked");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("Operating Room policy explain", () => {
  let workspace: InterfaceWorkspace;

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
  });

  test("renders allow deny and approval-required decisions with redacted targets", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, workspace);
    await openDesktopView(page, "Risk");

    await expect(page.locator("main")).toContainText("Policy Explain");
    await expect(page.locator("main")).toContainText("Allowed");
    await expect(page.locator("main")).toContainText("Denied");
    await expect(page.locator("main")).toContainText("Approval Required");
    await expect(page.locator("main")).toContainText("autonomy.push_commits");
    await expect(page.locator("main")).not.toContainText("sk-seededsecret123456");
  });
});

test.describe("Operating Room retry blockers", () => {
  let workspace: InterfaceWorkspace;

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
  });

  test("shows retry lineage and the current owner-visible blocker", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, workspace);
    await openDesktopView(page, "Risk");

    const main = page.locator("main");
    await expect(main).toContainText("Recover failed checkout flow.");
    await expect(main).toContainText("2 retry runs started");
    await expect(main).toContainText("Retry limit reached after 2 attempt");
    await expect(main).toContainText("Approval appr_");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("Operating Room external commitment approvals", () => {
  let workspace: InterfaceWorkspace;

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
  });

  test("shows approval source limit and expiry for serious external gates", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, workspace);
    await openDesktopView(page, "Approvals");

    const main = page.locator("main");
    await expect(main).toContainText("Send Final Proposals");
    await expect(main).toContainText("Source: revenue.pipeline:seeded-compliance-review");
    await expect(main).toContainText("Limit: Draft value $12,000; client send only");
    await expect(main).toContainText("Expires 2026-06-01");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("Operating Room revenue pulse", () => {
  let workspace: InterfaceWorkspace;

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
  });

  test("uses stored revenue history and client intelligence without invented deltas", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, workspace);
    await openDesktopView(page, "Revenue");

    const body = page.locator("body");
    await expect(body).toContainText("Revenue Pulse");
    await expect(body).toContainText("stored snapshots");
    await expect(body).toContainText("+$3K vs last report");
    await expect(body).toContainText("Top Clients by LTV");
    await expect(body).toContainText("Client memory");
    await expect(body).toContainText("Acme Labs");
    await expect(body).not.toContainText(/vs 30d|MTD|Last 90d/);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("Operating Room agent layer detail", () => {
  let workspace: InterfaceWorkspace;

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
  });

  test("opens agent details with run and capability usage without shifting layout", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, workspace);

    const layer = page.locator("section").filter({ hasText: "Agent Layer" }).last();
    await layer.getByRole("button", { name: /Development Agent/i }).click();
    const dialog = page.getByRole("dialog");

    await expect(dialog).toContainText("Agent Detail");
    await expect(dialog).toContainText("Development Agent");
    await expect(dialog).toContainText("Recent run");
    await expect(dialog).toContainText("Development agent validates the seeded website workflow.");
    await expect(dialog).toContainText("Capability Usage");
    await expect(dialog).toContainText("codex");
    await expect(dialog).toContainText("edit_code");
    await expectNoHorizontalOverflow(page);

    await dialog.getByRole("button", { name: /Agent list/i }).click();
    await dialog.getByRole("button", { name: /QA Agent/i }).click();
    await expect(dialog).toContainText("No active run");
    await expect(dialog).toContainText("No active or recent run for this agent.");
  });
});

test.describe("Operating Room linked work dashboard", () => {
  let workspace: InterfaceWorkspace;

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
  });

  test("renders Linear run PR and stale GitHub signal links without merge or deploy actions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page, workspace);
    await openDesktopView(page, "Delivery");

    const main = page.locator("main");
    await expect(main).toContainText("Linked Work Dashboard");
    await expect(main).toContainText("SER-89");
    await expect(main).toContainText("#42");
    await expect(main).toContainText("codex/ser-89-linked-work-dashboard");
    await expect(main).toContainText("SER-90");
    await expect(main).toContainText("Stale 2");
    await expect(main).not.toContainText(/\bMerge\b|\bDeploy\b/);
    await expectNoHorizontalOverflow(page);
  });
});

async function openWorkspace(page: Page, workspace: InterfaceWorkspace): Promise<void> {
  await page.goto(`/?apiBase=${encodeURIComponent(workspace.url)}`);
  await expect(page).toHaveTitle(/BureauOS - Operating Room/);
  await expect(page.locator("body")).toContainText("Operating Room");
  await expect(page.locator("body")).not.toContainText("API server unreachable");
}

async function openDesktopView(page: Page, nav: string): Promise<void> {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: navMatcher(nav) })
    .click();
}

async function openCompactView(page: Page, nav: string): Promise<void> {
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await page.getByRole("button", { name: navMatcher(nav) }).click();
  await expect(drawer).toBeHidden();
  await page.waitForTimeout(260);
}

async function expectNoFrameworkOverlay(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText(
    /Internal server error|Vite Error|React error/i,
  );
}

async function expectNoForbiddenRendererData(page: Page): Promise<void> {
  const bodyText = await page.locator("body").innerText();
  for (const pattern of FORBIDDEN_RENDERER_PATTERNS) {
    expect(bodyText, `visible renderer text should not match ${pattern}`).not.toMatch(pattern);
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      overflowingText: [...document.querySelectorAll("main *")]
        .map((element) => {
          if (element.closest('[data-e2e-horizontal-scroll="true"]')) return undefined;
          const rect = element.getBoundingClientRect();
          const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "";
          return { rect, text, tag: element.tagName.toLowerCase() };
        })
        .filter((item): item is NonNullable<typeof item> => item !== undefined)
        .filter(
          (item) =>
            item.rect.width > 1 &&
            item.rect.height > 1 &&
            (item.rect.left < -2 || item.rect.right > window.innerWidth + 2),
        )
        .slice(0, 5),
    };
  });

  expect(
    overflow.scrollWidth,
    JSON.stringify(overflow.overflowingText, null, 2),
  ).toBeLessThanOrEqual(overflow.clientWidth + 2);
  expect(overflow.overflowingText).toEqual([]);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const body = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

function navMatcher(nav: string): RegExp {
  return new RegExp(`^${escapeRegExp(nav)}(?:\\s+\\d+)?$`);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
