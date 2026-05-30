const LEGACY_IDLE_MARKERS = [
  "Non apro clienti, progetti o task da un saluto generico",
  "Non uso memoria storica per inventare una richiesta corrente.",
  "Postura attiva:",
  "Resto in attesa di una richiesta concreta oppure di un riferimento esplicito a un progetto/cliente esistente.",
  // Previous hardcoded one-liner greeting (migrated to the intent/language-aware reply).
  "Ciao Emanuele, ci sono.",
];

type IdleIntent = "thanks" | "how_are_you" | "greeting";

/**
 * Detect whether the owner's short message is in English. The Operating Room
 * defaults to Italian, so we only switch to English on a clear English signal
 * (and never when an Italian greeting/closing token is present).
 */
function isEnglishMessage(message: string): boolean {
  const lower = message.toLowerCase();
  if (
    /\b(ciao|salve|buongiorno|buonasera|buonanotte|grazie|come va|come stai|tutto bene)\b/.test(
      lower,
    )
  ) {
    return false;
  }
  return /\b(hi|hello|hey|yo|thanks|thank you|cheers|how are you|how's it going|good (morning|afternoon|evening))\b/.test(
    lower,
  );
}

function classifyIdleIntent(message: string): IdleIntent {
  const lower = message.toLowerCase();
  if (
    /\b(grazie|thanks|thank you|thank|cheers|perfetto|perfect|ricevuto|ok|okay|va bene|great|got it)\b/.test(
      lower,
    )
  ) {
    return "thanks";
  }
  if (/\b(come va|come stai|how are you|how's it going|how are things|tutto bene)\b/.test(lower)) {
    return "how_are_you";
  }
  return "greeting";
}

/**
 * Reply to a low-context greeting / small-talk message.
 *
 * The reply is intent-aware (greeting vs thanks vs how-are-you) and matches the
 * owner's language. It does NOT hardcode an owner name and uses correct Italian
 * accents. When the configured provider failed, the issue is appended so the
 * owner knows the coordinator fell back to local handling. (SER-217)
 */
export function coordinatorIdleAnswer(message = "", providerIssue = ""): string {
  const english = isEnglishMessage(message);
  const intent = classifyIdleIntent(message);

  let base: string;
  if (intent === "thanks") {
    base = english
      ? "Anytime. Ping me when you want to pick the next move."
      : "Di nulla. Quando vuoi, ripartiamo.";
  } else if (intent === "how_are_you") {
    base = english
      ? "All running on my side. What should I focus on?"
      : "Tutto operativo da questa parte. Su cosa vuoi che mi concentri?";
  } else {
    base = english
      ? "Hi! I'm ready — tell me where to start: today's priorities, a client, or a proposal."
      : "Ciao! Sono operativo — dimmi da dove partiamo: priorità di oggi, un cliente o una proposta.";
  }

  return providerIssue ? `${base} ${providerIssue}`.trim() : base;
}

/**
 * Reply to an identity / "who are you" message — a crisp role intro, language-
 * matched, no hardcoded owner name, correct accents.
 */
export function coordinatorIdentityAnswer(message = ""): string {
  if (isEnglishMessage(message)) {
    return "I'm the BureauOS Supreme Coordinator: I keep your clients, projects, delivery, priorities and risks together and turn your goals into verifiable next steps.";
  }
  return "Sono il Supreme Coordinator di BureauOS: tengo insieme clienti, progetti, consegne, priorità e rischi, e trasformo i tuoi obiettivi in prossimi passi verificabili.";
}

export function isLegacyLowContextCoordinatorAnswer(input: {
  role: string;
  text: string;
  meta?: Record<string, unknown>;
}): boolean {
  if (input.role !== "coordinator") return false;
  const grounding = input.meta?.["grounding"];
  if (grounding !== "low_context_current_message") return false;
  return LEGACY_IDLE_MARKERS.some((marker) => input.text.includes(marker));
}
