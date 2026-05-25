const LEGACY_IDLE_MARKERS = [
  "Non uso memoria storica per inventare una richiesta corrente.",
  "Resto in attesa di una richiesta concreta oppure di un riferimento esplicito a un progetto/cliente esistente.",
];

export function coordinatorIdleAnswer(providerIssue = ""): string {
  return [
    "Ciao Emanuele. Sono operativo.",
    providerIssue,
    "Non apro clienti, progetti o task da un saluto generico: tengo separati memoria storica e richiesta corrente.",
    "",
    "Postura attiva:",
    "- monitoro memoria aziendale, provider, approvazioni, follow-up e segnali di rischio;",
    "- quando nomini un cliente o un progetto, lavoro su quello senza trascinare vecchi esempi;",
    "- quando chiedi lo stato, rispondo da registri e memoria locale verificabile.",
  ]
    .filter(Boolean)
    .join("\n");
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
