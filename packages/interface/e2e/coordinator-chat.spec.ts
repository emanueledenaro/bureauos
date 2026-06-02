import { expect, test } from "@playwright/test";
import { createInterfaceWorkspace, type InterfaceWorkspace } from "./interface-workspace.js";

test.describe("Coordinator chat experience", () => {
  let workspace: InterfaceWorkspace;

  test.beforeAll(async () => {
    workspace = await createInterfaceWorkspace("seeded");
  });

  test.afterAll(async () => {
    await workspace.close();
  });

  test("typing a slash shows the slash-command menu", async ({ page }) => {
    // Pure frontend test — no provider required. The SlashCommandMenu renders
    // entirely client-side from SLASH_COMMANDS; always deterministic.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?apiBase=${encodeURIComponent(workspace.url)}`);
    await page.getByRole("button", { name: "Coordinator" }).first().click();
    await expect(page.locator("main")).toContainText("Supreme Coordinator");

    const composer = page.getByPlaceholder(/Message a decision|Scrivi/i);
    await composer.click();
    await composer.fill("/prop");
    await expect(page.getByText(/Draft a proposal|Bozza di proposta/i)).toBeVisible();
  });

  test("composer sends with Enter and renders a coordinator reply with actions", async ({
    page,
  }) => {
    // The coordinator chat service always produces a reply even without a
    // configured model provider: the stream() path falls back to
    // deterministicAnswer() in packages/core/src/coordinator/chat.ts when no
    // provider is available. Therefore the Copy action button is always visible
    // after the turn completes — this assertion is deterministic offline.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?apiBase=${encodeURIComponent(workspace.url)}`);
    await page.getByRole("button", { name: "Coordinator" }).first().click();
    await expect(page.locator("main")).toContainText("Supreme Coordinator");

    const composer = page.getByPlaceholder(/Message a decision|Scrivi/i);
    await composer.click();
    await composer.fill("Give me today's operating focus");
    await composer.press("Enter");

    // A coordinator reply always renders (deterministic fallback even without a
    // live model). Its action row (Copy button) becomes visible once the turn is
    // persisted and the streaming message is replaced by the final record.
    await expect(page.getByRole("button", { name: /Copy|Copia/i }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
