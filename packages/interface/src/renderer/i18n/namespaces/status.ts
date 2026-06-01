import type { CatalogNamespace } from "../types";

/**
 * Backend status / enum values rendered to the owner. Keyed by the normalized
 * snake_case token (see `lib/status-labels.ts`). The English side mirrors the
 * `formatLabel()` title-casing so the catalog stays the single source of truth
 * for both languages; unmapped tokens fall back to `formatLabel()` at runtime.
 */
export default {
  en: {
    // Generic / shared states
    "status.active": "Active",
    "status.inactive": "Inactive",
    "status.pending": "Pending",
    "status.draft": "Draft",
    "status.blocked": "Blocked",
    "status.completed": "Completed",
    "status.in_progress": "In Progress",
    "status.cancelled": "Cancelled",
    "status.failed": "Failed",
    "status.ready": "Ready",
    "status.empty": "Empty",
    "status.linked": "Linked",
    "status.missing": "Missing",
    "status.stale": "Stale",
    "status.watch": "Watch",
    "status.clear": "Clear",
    "status.urgent": "Urgent",
    "status.review": "Review",
    "status.info": "Info",

    // Project statuses
    "status.intake": "Intake",
    "status.proposal": "Proposal",
    "status.approved": "Approved",
    "status.delivered": "Delivered",

    // Opportunity statuses
    "status.qualify": "Qualify",
    "status.qualified": "Qualified",
    "status.proposal_draft": "Proposal Draft",
    "status.proposal_sent": "Proposal Sent",
    "status.won": "Won",
    "status.lost": "Lost",
    "status.stalled": "Stalled",

    // Run statuses
    "status.created": "Created",
    "status.context_loading": "Context Loading",
    "status.planning": "Planning",
    "status.dispatching": "Dispatching",
    "status.verifying": "Verifying",
    "status.needs_human": "Needs Human",
    "status.ready_for_review": "Ready For Review",

    // Run / work types
    "status.feature": "Feature",
    "status.bug": "Bug",
    "status.release": "Release",

    // Approval statuses
    "status.rejected": "Rejected",
    "status.expired": "Expired",

    // Capability statuses
    "status.configured": "Configured",
    "status.available": "Available",

    // Client relationship risk
    "status.follow_up_due": "Follow-up Due",

    // Artifact statuses
    "status.superseded": "Superseded",
    "status.current": "Current",

    // Risk levels
    "status.low": "Low",
    "status.medium": "Medium",
    "status.high": "High",
    "status.critical": "Critical",

    // Portfolio record kinds
    "status.project": "Project",
    "status.opportunity": "Opportunity",
    "status.run": "Run",

    // Approval types
    "status.standing": "Standing",
    "status.one_off": "One-off",
  },
  it: {
    // Generic / shared states
    "status.active": "Attivo",
    "status.inactive": "Inattivo",
    "status.pending": "In attesa",
    "status.draft": "Bozza",
    "status.blocked": "Bloccato",
    "status.completed": "Completato",
    "status.in_progress": "In corso",
    "status.cancelled": "Annullato",
    "status.failed": "Fallito",
    "status.ready": "Pronto",
    "status.empty": "Vuoto",
    "status.linked": "Collegato",
    "status.missing": "Mancante",
    "status.stale": "Obsoleto",
    "status.watch": "Da monitorare",
    "status.clear": "A posto",
    "status.urgent": "Urgente",
    "status.review": "Da rivedere",
    "status.info": "Info",

    // Project statuses
    "status.intake": "Acquisizione",
    "status.proposal": "Proposta",
    "status.approved": "Approvato",
    "status.delivered": "Consegnato",

    // Opportunity statuses
    "status.qualify": "Qualifica",
    "status.qualified": "Qualificato",
    "status.proposal_draft": "Bozza di proposta",
    "status.proposal_sent": "Proposta inviata",
    "status.won": "Acquisito",
    "status.lost": "Perso",
    "status.stalled": "In stallo",

    // Run statuses
    "status.created": "Creato",
    "status.context_loading": "Caricamento contesto",
    "status.planning": "Pianificazione",
    "status.dispatching": "Assegnazione",
    "status.verifying": "Verifica",
    "status.needs_human": "Richiede intervento",
    "status.ready_for_review": "Pronto per la revisione",

    // Run / work types
    "status.feature": "Funzionalità",
    "status.bug": "Bug",
    "status.release": "Rilascio",

    // Approval statuses
    "status.rejected": "Rifiutato",
    "status.expired": "Scaduto",

    // Capability statuses
    "status.configured": "Configurato",
    "status.available": "Disponibile",

    // Client relationship risk
    "status.follow_up_due": "Follow-up in scadenza",

    // Artifact statuses
    "status.superseded": "Sostituito",
    "status.current": "Attuale",

    // Risk levels
    "status.low": "Basso",
    "status.medium": "Medio",
    "status.high": "Alto",
    "status.critical": "Critico",

    // Portfolio record kinds
    "status.project": "Progetto",
    "status.opportunity": "Opportunità",
    "status.run": "Esecuzione",

    // Approval types
    "status.standing": "Permanente",
    "status.one_off": "Una tantum",
  },
} satisfies CatalogNamespace;
