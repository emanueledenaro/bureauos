const LEGACY_IDLE_MARKERS = [
  "Non apro clienti, progetti o task da un saluto generico",
  "Non uso memoria storica per inventare una richiesta corrente.",
  "Postura attiva:",
  "Resto in attesa di una richiesta concreta oppure di un riferimento esplicito a un progetto/cliente esistente.",
];

export function coordinatorIdleAnswer(providerIssue = ""): string {
  if (providerIssue) {
    return `Ciao Emanuele, ci sono. ${providerIssue} Quando vuoi, dimmi su cosa lavoriamo.`;
  }
  return "Ciao Emanuele, ci sono.";
}

export function coordinatorIdentityAnswer(): string {
  return [
    "Ciao Emanuele, sono il Supreme Coordinator di BureauOS.",
    "Tengo insieme clienti, progetti, consegne, priorita e rischi; quando mi dai un obiettivo operativo, lo trasformo in prossimi passi verificabili.",
  ].join(" ");
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
