import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createInterfaceWorkspace, type InterfaceWorkspace } from "./interface-workspace.js";

const OUTPUT_ROOT =
  process.env["BUREAUOS_VISUAL_QA_OUTPUT"] ??
  join(
    process.cwd(),
    "artifacts",
    "interface-visual-qa",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );

const VIEWS = [
  { nav: "Home", expected: "Portfolio Operating Room" },
  { nav: "Coordinator", expected: "Supreme Coordinator" },
  { nav: "Revenue", expected: "Revenue" },
  { nav: "Delivery", expected: "Delivery" },
  { nav: "Clients", expected: "Clients" },
  { nav: "Growth", expected: "Growth" },
  { nav: "Memory", expected: "Memory" },
  { nav: "Approvals", expected: "Approvals" },
] as const;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000, compact: false },
  { name: "tablet", width: 768, height: 1024, compact: true },
  { name: "phone", width: 390, height: 844, compact: true },
] as const;

interface ManifestItem {
  viewport: string;
  view: string;
  path: string;
}

test.describe.configure({ mode: "serial" });

test.describe("Operating Room visual QA artifacts", () => {
  let workspace: InterfaceWorkspace;
  const manifest: ManifestItem[] = [];

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
    const manifestPath = join(OUTPUT_ROOT, "manifest.json");
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), screenshots: manifest }, null, 2)}\n`,
      "utf8",
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`captures review screenshots on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openWorkspace(page, workspace);

      for (const view of VIEWS) {
        if (viewport.compact) {
          await openCompactView(page, view.nav);
        } else {
          await openDesktopView(page, view.nav);
        }
        await expect(page.locator("main")).toContainText(view.expected);
        await expectNoFrameworkOverlay(page);
        await expectNoUnexpectedOverflow(page);
        await page.waitForTimeout(160);

        const path = join(OUTPUT_ROOT, viewport.name, `${slug(view.nav)}.png`);
        await mkdir(dirname(path), { recursive: true });
        await page.screenshot({ path, fullPage: false });
        manifest.push({ viewport: viewport.name, view: view.nav, path });
      }
    });
  }
});

async function openWorkspace(page: Page, workspace: InterfaceWorkspace): Promise<void> {
  await page.goto(`/?apiBase=${encodeURIComponent(workspace.url)}`);
  await expect(page).toHaveTitle(/BureauOS - Operating Room/);
  await expect(page.locator("body")).toContainText("Operating Room");
  await expect(page.locator("body")).not.toContainText("API server unreachable");
}

async function openDesktopView(page: Page, nav: string): Promise<void> {
  await page.locator("aside button", { hasText: nav }).click();
}

async function openCompactView(page: Page, nav: string): Promise<void> {
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await drawer.getByRole("button", { name: navMatcher(nav) }).click();
  await expect(drawer).toBeHidden();
  await page.waitForTimeout(260);
}

async function expectNoFrameworkOverlay(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText(
    /Internal server error|Vite Error|React error/i,
  );
}

async function expectNoUnexpectedOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")]
      .map((element) => {
        if (element.closest('[data-e2e-horizontal-scroll="true"]')) return undefined;
        if (element.closest('[data-state="closed"], [aria-hidden="true"]')) return undefined;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return undefined;
        if (getComputedStyle(element).position === "fixed") return undefined;
        const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "";
        return { tag: element.tagName.toLowerCase(), text, left: rect.left, right: rect.right };
      })
      .filter((item): item is { tag: string; text: string; left: number; right: number } =>
        Boolean(item),
      )
      .filter((item) => item.left < -2 || item.right > width + 2)
      .slice(0, 5);
  });

  expect(overflow, JSON.stringify(overflow, null, 2)).toEqual([]);
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
