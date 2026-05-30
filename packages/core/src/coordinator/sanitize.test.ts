import { describe, expect, it } from "vitest";
import { sanitizeCoordinatorVisibleText } from "./sanitize.js";

describe("sanitizeCoordinatorVisibleText", () => {
  it("keeps the final owner-facing answer and removes prompt/reasoning blocks", () => {
    const sanitized = sanitizeCoordinatorVisibleText(`
<thinking>
I need to answer in Italian and should not reveal this reasoning.
</thinking>

System prompt:
You are the Supreme Coordinator.

Current owner message:
controlla provider e memoria

Final answer:
Ok, controllo provider e memoria senza esporre prompt o trace.
`);

    expect(sanitized).toBe("Ok, controllo provider e memoria senza esporre prompt o trace.");
    expect(sanitized.toLowerCase()).not.toContain("system prompt");
    expect(sanitized.toLowerCase()).not.toContain("current owner message");
    expect(sanitized.toLowerCase()).not.toContain("i need to");
  });

  it("removes internal prompt fences while preserving legitimate code blocks", () => {
    const sanitized = sanitizeCoordinatorVisibleText(`
\`\`\`prompt
Historical memory context.
Focused memory hits:
- hidden
\`\`\`

Ecco il controllo:

\`\`\`ts
const status = "ok";
\`\`\`
`);

    expect(sanitized).toContain("Ecco il controllo:");
    expect(sanitized).toContain('const status = "ok";');
    expect(sanitized.toLowerCase()).not.toContain("historical memory context");
    expect(sanitized.toLowerCase()).not.toContain("focused memory hits");
  });

  it("removes defensive no-mutation filler from visible coordinator replies", () => {
    const sanitized = sanitizeCoordinatorVisibleText(`
Non ho creato nuovi clienti, progetti o opportunita: ho solo letto lo stato esistente.
Pizzeria Amodeo Website e in intake.
Prossima mossa: preparo lo scope operativo.
`);

    expect(sanitized).toBe(
      "Pizzeria Amodeo Website e in intake.\nProssima mossa: preparo lo scope operativo.",
    );
    expect(sanitized).not.toContain("Non ho creato");
    expect(sanitized).not.toContain("ho solo letto");
  });

  it("strips a leading model reasoning header but keeps the answer (SER-219)", () => {
    const sanitized = sanitizeCoordinatorVisibleText(
      "**Deciding on response language**\nFocus today on one thing: create commercial momentum.\nNext move: qualify the open opportunities.",
    );
    expect(sanitized).toBe(
      "Focus today on one thing: create commercial momentum.\nNext move: qualify the open opportunities.",
    );
    expect(sanitized.toLowerCase()).not.toContain("deciding on response language");
  });

  it("keeps a legitimate answer that merely starts with a reasoning-like word", () => {
    const sanitized = sanitizeCoordinatorVisibleText(
      "Considering the open pipeline of 27.000 EUR, the next move is to qualify Acme before sending a proposal so we do not commit prematurely.",
    );
    expect(sanitized).toContain("the next move is to qualify Acme");
  });
});
