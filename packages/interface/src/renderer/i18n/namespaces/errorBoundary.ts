import type { CatalogNamespace } from "../types";

export default {
  en: {
    "errorBoundary.title": "The Operating Room hit a display error",
    "errorBoundary.body":
      "The view was paused to avoid a blank screen. Your workspace data is safe — the underlying action, if any, already completed. Reload to continue.",
    "errorBoundary.reload": "Reload",
    "errorBoundary.tryAgain": "Try again",
  },
  it: {
    "errorBoundary.title": "L'Operating Room ha riscontrato un errore di visualizzazione",
    "errorBoundary.body":
      "La vista è stata sospesa per evitare una schermata vuota. I dati del tuo spazio di lavoro sono al sicuro — l'azione sottostante, se presente, è già stata completata. Ricarica per continuare.",
    "errorBoundary.reload": "Ricarica",
    "errorBoundary.tryAgain": "Riprova",
  },
} satisfies CatalogNamespace;
