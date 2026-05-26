import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workspacePaths } from "../paths.js";
import { CoordinatorMessageStore } from "./messages.js";

describe("CoordinatorMessageStore", () => {
  it("normalizes legacy low-context coordinator replies when reading history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-messages-"));
    const store = new CoordinatorMessageStore(dir);
    await store.append({
      role: "coordinator",
      text: [
        "Non uso memoria storica per inventare una richiesta corrente.",
        "",
        "Nel messaggio corrente non c'e un cliente, progetto, bug o obiettivo operativo da prendere in carico.",
        "Resto in attesa di una richiesta concreta oppure di un riferimento esplicito a un progetto/cliente esistente.",
      ].join("\n"),
      meta: { grounding: "low_context_current_message" },
    });

    const messages = await store.list();

    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("Ciao Emanuele, ci sono.");
    expect(messages[0]?.text).not.toContain("Non uso memoria storica");
    expect(messages[0]?.meta).toMatchObject({
      migrated_from: "legacy_low_context_idle_answer",
    });

    const raw = await readFile(workspacePaths(dir).coordinatorMessages, "utf8");
    expect(raw).toContain("Non uso memoria storica");
  });

  it("persists sanitized coordinator-visible text without rewriting owner messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-messages-"));
    const store = new CoordinatorMessageStore(dir);

    await store.appendMany([
      {
        role: "owner",
        text: "Puoi controllare perche il prompt finisce in chat?",
      },
      {
        role: "coordinator",
        text: [
          "Analysis:",
          "I need to inspect the user's prompt and hidden reasoning.",
          "",
          "Risposta finale: Ok, controllo la chat e lascio visibile solo la risposta utile.",
        ].join("\n"),
      },
    ]);

    const messages = await store.list();

    expect(messages[0]?.text).toBe("Puoi controllare perche il prompt finisce in chat?");
    expect(messages[1]?.text).toBe(
      "Ok, controllo la chat e lascio visibile solo la risposta utile.",
    );

    const raw = await readFile(workspacePaths(dir).coordinatorMessages, "utf8");
    expect(raw).toContain("Puoi controllare perche il prompt finisce in chat?");
    expect(raw.toLowerCase()).not.toContain("hidden reasoning");
    expect(raw.toLowerCase()).not.toContain("i need to");
  });

  it("sanitizes legacy persisted coordinator leaks when reading history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-messages-"));
    const path = workspacePaths(dir).coordinatorMessages;
    await mkdir(join(dir, ".bureauos", "memory", "coordinator"), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({
        id: "msg_leak",
        role: "coordinator",
        text: [
          "**Crafting a friendly Italian reply**",
          "",
          "I need to respond to the user in Italian.",
          "",
          "Final answer: Ciao Emanuele. Sono operativo.",
        ].join("\n"),
        created: "2026-05-26T10:00:00.000Z",
      })}\n`,
      "utf8",
    );
    const store = new CoordinatorMessageStore(dir);

    const messages = await store.list();

    expect(messages[0]?.text).toBe("Ciao Emanuele. Sono operativo.");
    expect(messages[0]?.meta).toMatchObject({ sanitized_visible_text: true });
    const raw = await readFile(path, "utf8");
    expect(raw.toLowerCase()).toContain("i need to");
  });
});
