import { mkdtemp, readFile } from "node:fs/promises";
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
    expect(messages[0]?.text).toContain("Sono operativo");
    expect(messages[0]?.text).not.toContain("Non uso memoria storica");
    expect(messages[0]?.meta).toMatchObject({
      migrated_from: "legacy_low_context_idle_answer",
    });

    const raw = await readFile(workspacePaths(dir).coordinatorMessages, "utf8");
    expect(raw).toContain("Non uso memoria storica");
  });
});
