import type { CatalogNamespace } from "../types";

export default {
  en: {
    "goals.title": "Goals",
    "goals.description": "Company OKRs and operating milestones derived from current registries.",
    "goals.colMilestone": "Milestone",
    "goals.colProgress": "Progress",
    "goals.open": "Open",
    "goals.goalHealth": "Goal health",
    "goals.goalHealthDetail": "Average objective progress",
    "goals.atRisk": "At risk",
    "goals.atRiskDetail": "Needs owner or coordinator attention",
    "goals.nextMilestone": "Next milestone",
    "goals.noGoalsLoaded": "No goals loaded",
    "goals.emptyDescription": "Goals derive from the current company registries.",

    // Goal cards (derived in lib/builders.ts buildGoalItems)
    "goals.revenueEngineTitle": "Revenue Engine",
    "goals.revenueEngineDescription": "Maintain active commercial pipeline across client accounts.",
    "goals.revenueEngineTarget": "Every active client has an open opportunity",
    "goals.revenueEngineNextActive":
      "Prioritize the highest-value opportunity and move it to proposal.",
    "goals.revenueEngineNextEmpty": "Create or import the first qualified opportunity.",
    "goals.deliveryHealthTitle": "Delivery Health",
    "goals.deliveryHealthDescription":
      "Keep client and internal projects unblocked and repository-backed.",
    "goals.deliveryHealthTarget": "0 blocked projects",
    "goals.deliveryHealthNextBlocked":
      "Open the blocked project queue and assign a recovery action.",
    "goals.deliveryHealthNextClear": "Dispatch the next project-manager run for active work.",
    "goals.clientSuccessTitle": "Client Success",
    "goals.clientSuccessDescription":
      "Protect relationships with follow-up discipline and account visibility.",
    "goals.clientSuccessTarget": "No overdue client follow-ups",
    "goals.clientSuccessNextDue":
      "Review clients due for follow-up and prepare safe response drafts.",
    "goals.clientSuccessNextClear": "Create the next account plan for the most valuable client.",
    "goals.growthFoundationTitle": "Growth Foundation",
    "goals.growthFoundationDescription":
      "Keep brand, offers, channels, and draft assets ready for visibility work.",
    "goals.growthFoundationTarget": "Brand, offers, channels, and one draft asset ready",
    "goals.growthFoundationNextReady":
      "Generate the next draft-only growth asset from current positioning.",
    "goals.growthFoundationNextIncomplete": "Complete missing growth memory before campaign work.",
    "goals.autonomyReadinessTitle": "Autonomy Readiness",
    "goals.autonomyReadinessDescription":
      "Make the operating system capable of running without owner babysitting.",
    "goals.autonomyReadinessTarget": "API, agents, capabilities, provider, and growth memory ready",
    "goals.autonomyReadinessNextReady":
      "Review remaining autonomy checks and keep policy gates tight.",
    "goals.autonomyReadinessNextProvider":
      "Connect a provider or fix missing provider credentials.",
    "goals.executionCadenceTitle": "Execution Cadence",
    "goals.executionCadenceDescription":
      "Track whether autonomous runs are completing instead of piling up.",
    "goals.executionCadenceTarget": "Runs complete without human-blocked drift",
    "goals.executionCadenceNextIssues":
      "Resolve runs needing human input before starting more work.",
    "goals.executionCadenceNextClear": "Start the next useful run from Today or project dispatch.",

    // Goal "current" / signal unit words
    "goals.unitAccounts": "accounts",
    "goals.unitBlocked": "blocked",
    "goals.unitDue": "due",
    "goals.unitMemorySections": "memory sections",
    "goals.unitChecks": "checks",
    "goals.unitCompleted": "completed",
    "goals.signalOpenPipeline": "open pipeline",
    "goals.signalOpenOpportunities": "open opportunities",
    "goals.signalActiveProjects": "active projects",
    "goals.signalRepositoriesLinked": "repositories linked",
    "goals.signalClientProfiles": "client profiles",
    "goals.signalAccountViews": "account views",
    "goals.signalGrowthArtifacts": "growth artifacts",
    "goals.signalOwnerDecisions": "owner decisions",
    "goals.signalAgents": "agents",
    "goals.signalCapabilities": "capabilities",
    "goals.signalIssueRuns": "issue runs",
    "goals.signalAuditEvents": "recent audit events",
  },
  it: {
    "goals.title": "Obiettivi",
    "goals.description": "OKR aziendali e tappe operative derivati dai registri attuali.",
    "goals.colMilestone": "Tappa",
    "goals.colProgress": "Avanzamento",
    "goals.open": "Apri",
    "goals.goalHealth": "Salute degli obiettivi",
    "goals.goalHealthDetail": "Avanzamento medio degli obiettivi",
    "goals.atRisk": "A rischio",
    "goals.atRiskDetail": "Richiede l'attenzione del titolare o del coordinatore",
    "goals.nextMilestone": "Prossima tappa",
    "goals.noGoalsLoaded": "Nessun obiettivo caricato",
    "goals.emptyDescription": "Gli obiettivi derivano dai registri aziendali attuali.",

    // Goal cards (derived in lib/builders.ts buildGoalItems)
    "goals.revenueEngineTitle": "Motore dei ricavi",
    "goals.revenueEngineDescription":
      "Mantieni una pipeline commerciale attiva su tutti gli account cliente.",
    "goals.revenueEngineTarget": "Ogni cliente attivo ha un'opportunità aperta",
    "goals.revenueEngineNextActive":
      "Dai priorità all'opportunità di maggior valore e portala a proposta.",
    "goals.revenueEngineNextEmpty": "Crea o importa la prima opportunità qualificata.",
    "goals.deliveryHealthTitle": "Salute della consegna",
    "goals.deliveryHealthDescription":
      "Mantieni i progetti dei clienti e interni sbloccati e supportati da repository.",
    "goals.deliveryHealthTarget": "0 progetti bloccati",
    "goals.deliveryHealthNextBlocked":
      "Apri la coda dei progetti bloccati e assegna un'azione di recupero.",
    "goals.deliveryHealthNextClear":
      "Avvia la prossima esecuzione del project manager per il lavoro attivo.",
    "goals.clientSuccessTitle": "Successo del cliente",
    "goals.clientSuccessDescription":
      "Proteggi le relazioni con disciplina nei follow-up e visibilità sugli account.",
    "goals.clientSuccessTarget": "Nessun follow-up cliente in ritardo",
    "goals.clientSuccessNextDue":
      "Esamina i clienti in scadenza per follow-up e prepara bozze di risposta sicure.",
    "goals.clientSuccessNextClear": "Crea il prossimo piano account per il cliente più importante.",
    "goals.growthFoundationTitle": "Fondamenta di crescita",
    "goals.growthFoundationDescription":
      "Mantieni brand, offerte, canali e bozze pronti per il lavoro di visibilità.",
    "goals.growthFoundationTarget": "Brand, offerte, canali e una bozza pronti",
    "goals.growthFoundationNextReady":
      "Genera la prossima bozza di asset di crescita dal posizionamento attuale.",
    "goals.growthFoundationNextIncomplete":
      "Completa la memoria di crescita mancante prima del lavoro sulle campagne.",
    "goals.autonomyReadinessTitle": "Prontezza all'autonomia",
    "goals.autonomyReadinessDescription":
      "Rendi il sistema operativo capace di funzionare senza supervisione del titolare.",
    "goals.autonomyReadinessTarget": "API, agenti, capacità, provider e memoria di crescita pronti",
    "goals.autonomyReadinessNextReady":
      "Esamina i controlli di autonomia rimanenti e mantieni rigidi i gate delle policy.",
    "goals.autonomyReadinessNextProvider":
      "Connetti un provider o correggi le credenziali del provider mancanti.",
    "goals.executionCadenceTitle": "Cadenza di esecuzione",
    "goals.executionCadenceDescription":
      "Verifica che le esecuzioni autonome si completino invece di accumularsi.",
    "goals.executionCadenceTarget":
      "Le esecuzioni si completano senza blocchi che richiedono l'intervento umano",
    "goals.executionCadenceNextIssues":
      "Risolvi le esecuzioni che richiedono intervento umano prima di avviarne altre.",
    "goals.executionCadenceNextClear":
      "Avvia la prossima esecuzione utile da Oggi o dall'assegnazione del progetto.",

    // Goal "current" / signal unit words
    "goals.unitAccounts": "account",
    "goals.unitBlocked": "bloccati",
    "goals.unitDue": "in scadenza",
    "goals.unitMemorySections": "sezioni di memoria",
    "goals.unitChecks": "controlli",
    "goals.unitCompleted": "completate",
    "goals.signalOpenPipeline": "pipeline aperta",
    "goals.signalOpenOpportunities": "opportunità aperte",
    "goals.signalActiveProjects": "progetti attivi",
    "goals.signalRepositoriesLinked": "repository collegati",
    "goals.signalClientProfiles": "profili cliente",
    "goals.signalAccountViews": "viste account",
    "goals.signalGrowthArtifacts": "artefatti di crescita",
    "goals.signalOwnerDecisions": "decisioni del titolare",
    "goals.signalAgents": "agenti",
    "goals.signalCapabilities": "capacità",
    "goals.signalIssueRuns": "esecuzioni con problemi",
    "goals.signalAuditEvents": "eventi di audit recenti",
  },
} satisfies CatalogNamespace;
