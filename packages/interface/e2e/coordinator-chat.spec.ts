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

  test("model picker is present in the composer and send still works without a connected provider", async ({
    page,
  }) => {
    // The seeded workspace has NO configured provider connections. As a result the
    // ModelPicker trigger renders in its disabled/empty state (label "No model
    // connected", aria-label "Model", disabled=true) — there are no selectable
    // options, so we cannot exercise an actual override selection here.
    //
    // What we assert instead is the durable, offline-deterministic contract:
    //   1. The ModelPicker trigger button is present in the composer footer.
    //   2. Sending a message succeeds anyway — the coordinator service always
    //      replies via deterministicAnswer() when no provider is connected,
    //      regardless of whether a modelOverride was requested.
    //
    // Full override-selection coverage (choosing an option from the list) is
    // exercised by the interface unit tests (ModelPicker.test.tsx) and by the
    // core tests (chat.test.ts override + fallback paths). The e2e seeded path
    // intentionally has no providers so that CI needs no external API keys.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?apiBase=${encodeURIComponent(workspace.url)}`);
    await page.getByRole("button", { name: "Coordinator" }).first().click();
    await expect(page.locator("main")).toContainText("Supreme Coordinator");

    // The ModelPicker trigger is a button with aria-label "Model" in the composer
    // footer. In the no-provider state it is disabled (options.length === 0) and
    // shows "No model connected" as its visible text.
    const modelPickerTrigger = page.getByRole("button", { name: /^Model$/i });
    await expect(modelPickerTrigger).toBeVisible({ timeout: 5_000 });
    // In the seeded workspace the button must be disabled — no providers connected.
    await expect(modelPickerTrigger).toBeDisabled();
    await expect(modelPickerTrigger).toContainText(/No model connected/i);

    // Even with no override available the send path must work — the coordinator
    // always produces a deterministic reply offline.
    const composer = page.getByPlaceholder(/Message a decision|Scrivi/i);
    await composer.click();
    await composer.fill("Check model override path");
    await composer.press("Enter");

    // Deterministic fallback reply: Copy button becomes visible once the turn completes.
    await expect(page.getByRole("button", { name: /Copy|Copia/i }).first()).toBeVisible({
      timeout: 30_000,
    });
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

    // The live reasoning transcript shows the coordinator's work while busy.
    // "Coordinator work" / "Lavoro del coordinatore" is the static header of the
    // ReasoningBlock component — it renders the entire time `busy` is true (from
    // the first SSE event until the stream completes). Even in the no-provider
    // deterministic offline path the turn involves real async I/O (memory
    // assembly, message persistence), so this element is visible for long enough
    // that Playwright's polling reliably catches it.
    //
    // NOTE: if this assertion proves flaky in CI (e.g. on a very fast machine
    // where the entire stream completes before Playwright polls), the durable
    // signal is the Copy button below — and the core unit tests in chat.test.ts
    // already assert that `reasoning` events are emitted in the generator. If you
    // observe flakiness, remove the toBeVisible assertion and keep the comment.
    await expect(page.getByText(/Coordinator work|Lavoro del coordinatore/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // A coordinator reply always renders (deterministic fallback even without a
    // live model). Its action row (Copy button) becomes visible once the turn is
    // persisted and the streaming message is replaced by the final record.
    await expect(page.getByRole("button", { name: /Copy|Copia/i }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
