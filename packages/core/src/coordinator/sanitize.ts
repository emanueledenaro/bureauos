const FINAL_ANSWER_MARKERS = [
  "final answer",
  "risposta finale",
  "owner-facing answer",
  "visible answer",
  "assistant response",
  "risposta per l'utente",
  "risposta",
];

const INTERNAL_SECTION_MARKERS = [
  "analysis",
  "chain of thought",
  "crafting",
  "current owner message",
  "debug trace",
  "developer message",
  "developer prompt",
  "focused memory hits",
  "grounding rule",
  "hidden reasoning",
  "historical memory context",
  "implementation thoughts",
  "internal notes",
  "internal reasoning",
  "memory prompt",
  "model prompt",
  "prompt",
  "raw provider payload",
  "reasoning",
  "recent coordinator thread",
  "scratchpad",
  "system message",
  "system prompt",
  "tool trace",
];

const INTERNAL_LINE_MARKERS = [
  "always-loaded root memory",
  "crafting",
  "current owner message",
  "developer prefers",
  "do not reveal",
  "focused memory hits",
  "grounding rule",
  "hidden reasoning",
  "historical memory context",
  "i need to",
  "i should",
  "i'm thinking",
  "need to respond",
  "raw provider payload",
  "recent coordinator thread",
  "respond as the supreme coordinator",
  "scratchpad",
  "system prompt",
  "the user",
];

const OWNER_FACING_STARTS = [
  "Al momento",
  "Bene",
  "Certo",
  "Ciao",
  "Emanuele",
  "Ho",
  "Ok",
  "Parto",
  "Per",
  "Procedo",
  "Ricevuto",
  "Siamo",
  "Sono operativo",
  "Ti",
  "Va bene",
];

const INTERNAL_TAG_PATTERN =
  /<\s*(analysis|thinking|thought|thoughts|scratchpad|reasoning|reflection|internal)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

const DEFENSIVE_NO_MUTATION_SENTENCE_PATTERN =
  /\bNon ho creato\b[^.!?\n]*(?:\bho solo letto\b[^.!?\n]*)?[.!?]?/giu;

const DEFENSIVE_READ_ONLY_SENTENCE_PATTERN =
  /\b(?:Ho solo letto|mi sono limitato a leggere|mi sono limitata a leggere)\b[^.!?\n]*[.!?]?/giu;

function stripTaggedInternalBlocks(text: string): string {
  return text.replace(INTERNAL_TAG_PATTERN, "");
}

function stripInternalFences(text: string): string {
  return text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (block, info: string, body: string) => {
    const probe = `${info}\n${body}`.toLowerCase();
    const internal = [...INTERNAL_SECTION_MARKERS, ...INTERNAL_LINE_MARKERS].some((marker) =>
      probe.includes(marker),
    );
    return internal ? "" : block;
  });
}

function finalAnswerRemainder(line: string): string | undefined {
  const trimmed = line.trim();
  const normalized = trimmed.replace(/^#{1,6}\s*/, "").replace(/^\*\*|\*\*$/g, "");
  const lower = normalized.toLowerCase();
  for (const marker of FINAL_ANSWER_MARKERS) {
    if (lower === marker) return "";
    if (lower.startsWith(`${marker}:`)) return normalized.slice(marker.length + 1).trim();
    if (lower.startsWith(`${marker} -`)) return normalized.slice(marker.length + 2).trim();
  }
  return undefined;
}

function isInternalHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const normalized = trimmed
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/:$/, "")
    .toLowerCase();
  return INTERNAL_SECTION_MARKERS.some(
    (marker) => normalized === marker || normalized.startsWith(`${marker} `),
  );
}

function isInternalLeakLine(line: string): boolean {
  const lower = line.trim().toLowerCase();
  if (!lower) return false;
  return INTERNAL_LINE_MARKERS.some((marker) => lower.includes(marker));
}

function ownerFacingStartIndex(text: string): number | undefined {
  const indexes = OWNER_FACING_STARTS.map((start) => text.indexOf(start))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  return indexes[0];
}

function stripLeadingInternalPreamble(text: string): string {
  const probe = text.slice(0, 900).toLowerCase();
  const hasInternalPreamble = [...INTERNAL_SECTION_MARKERS, ...INTERNAL_LINE_MARKERS].some(
    (marker) => probe.includes(marker),
  );
  if (!hasInternalPreamble) return text;
  const index = ownerFacingStartIndex(text);
  return index !== undefined ? text.slice(index) : text;
}

const LEADING_REASONING_VERB =
  /^(?:deciding|considering|determining|figuring out|thinking|planning|choosing|crafting|analy[sz]ing|reflecting|let me\b|i'?ll\b|i will\b|i need to\b|i should\b|working out|deciding on)\b/i;

/**
 * Remove a single leading model-reasoning header line such as
 * "**Deciding on response language**" / "Crafting a friendly reply" that some
 * providers emit before the actual answer. Conservative: only a bold/heading
 * line, or a short (<=60 char) line, that starts with a reasoning verb — so a
 * legitimate answer sentence beginning with one of those words is preserved.
 * (SER-219)
 */
function stripLeadingReasoningHeader(text: string): string {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !(lines[i] ?? "").trim()) i += 1;
  if (i >= lines.length) return text;
  const first = (lines[i] ?? "").trim();
  const bare = first
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*\s*|\s*\*\*$/g, "")
    .trim();
  const wasBoldOrHeading = first !== bare;
  if (LEADING_REASONING_VERB.test(bare) && (wasBoldOrHeading || bare.length <= 60)) {
    lines.splice(i, 1);
    while (i < lines.length && !(lines[i] ?? "").trim()) lines.splice(i, 1);
    return lines.join("\n");
  }
  return text;
}

function stripInternalLineSections(text: string): string {
  const output: string[] = [];
  let skippingInternalSection = false;

  for (const line of text.split(/\r?\n/)) {
    const finalRemainder = finalAnswerRemainder(line);
    if (finalRemainder !== undefined) {
      skippingInternalSection = false;
      if (finalRemainder) output.push(finalRemainder);
      continue;
    }

    if (isInternalHeading(line)) {
      skippingInternalSection = true;
      continue;
    }

    if (skippingInternalSection) {
      if (!line.trim()) continue;
      const start = ownerFacingStartIndex(line);
      if (start !== undefined) {
        skippingInternalSection = false;
        output.push(line.slice(start));
      }
      continue;
    }

    if (isInternalLeakLine(line)) continue;
    output.push(line);
  }

  return output.join("\n");
}

function stripDefensiveNoMutationFiller(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(DEFENSIVE_NO_MUTATION_SENTENCE_PATTERN, "")
        .replace(DEFENSIVE_READ_ONLY_SENTENCE_PATTERN, "")
        .replace(/^[\s:;-]+/, "")
        .replace(/[ \t]{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

function keepAfterFinalAnswerMarker(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const remainder = finalAnswerRemainder(lines[index] ?? "");
    if (remainder === undefined) continue;
    const before = lines.slice(0, index).join("\n").toLowerCase();
    const beforeLooksInternal = [...INTERNAL_SECTION_MARKERS, ...INTERNAL_LINE_MARKERS].some(
      (marker) => before.includes(marker),
    );
    if (!beforeLooksInternal && index > 1) continue;
    return [remainder, ...lines.slice(index + 1)].filter((line) => line !== "").join("\n");
  }
  return text;
}

export function sanitizeCoordinatorVisibleText(input: string): string {
  return stripDefensiveNoMutationFiller(
    stripInternalLineSections(
      stripLeadingReasoningHeader(
        stripLeadingInternalPreamble(
          keepAfterFinalAnswerMarker(stripInternalFences(stripTaggedInternalBlocks(input.trim()))),
        ),
      ),
    ),
  )
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeCoordinatorMessageText(input: string): string {
  return (
    sanitizeCoordinatorVisibleText(input) ||
    "Risposta non disponibile: il contenuto generato conteneva solo dettagli interni."
  );
}
