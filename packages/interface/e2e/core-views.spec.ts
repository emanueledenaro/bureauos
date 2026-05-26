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
