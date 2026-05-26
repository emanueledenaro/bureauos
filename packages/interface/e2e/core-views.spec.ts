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

const MOBILE_VIEWS = [
  { nav: "Home", expected: "Portfolio Operating Room" },
  { nav: "Coordinator", expected: "Supreme Coordinator" },
  { nav: "Approvals", expected: "Approvals" },
] as const;

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

    test("renders mobile navigation and priority views without overflow", async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openWorkspace(page, workspace);

      for (const view of MOBILE_VIEWS) {
        await openMobileView(page, view.nav);
        await expect(page.locator("main")).toContainText(view.expected);
        await expectNoFrameworkOverlay(page);
        await expectNoHorizontalOverflow(page);
        await expectNoForbiddenRendererData(page);
        await attachScreenshot(page, testInfo, `${kind}-${slug(view.nav)}-mobile`);
      }
    });
  });
}

async function openWorkspace(page: Page, workspace: InterfaceWorkspace): Promise<void> {
  await page.goto(`/?apiBase=${encodeURIComponent(workspace.url)}`);
  await expect(page).toHaveTitle(/BureauOS - Operating Room/);
  await expect(page.locator("body")).toContainText("Operating Room");
  await expect(page.locator("body")).not.toContainText("API server unreachable");
}

async function openDesktopView(page: Page, nav: string): Promise<void> {
  await page.getByRole("button", { name: navMatcher(nav) }).click();
}

async function openMobileView(page: Page, nav: string): Promise<void> {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: navMatcher(nav) }).click();
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
          const rect = element.getBoundingClientRect();
          const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "";
          return { rect, text, tag: element.tagName.toLowerCase() };
        })
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
