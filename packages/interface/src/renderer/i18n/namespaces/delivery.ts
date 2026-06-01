import type { CatalogNamespace } from "../types";

export default {
  en: {
    // Section shell + toolbar
    "delivery.title": "Delivery",
    "delivery.description": "Projects, repositories, status, and team execution.",
    "delivery.verifyRepositories": "Verify repositories",
    "delivery.verifying": "Verifying",
    "delivery.verify": "Verify",
    // Verification banners
    "delivery.verificationFailedTitle": "Repository verification failed",
    "delivery.verificationFailedFallback": "Repository verification failed.",
    "delivery.lastVerificationTitle": "Last repository verification",
    "delivery.verified": "verified",
    "delivery.attention": "attention",
    "delivery.unverified": "unverified",
    "delivery.now": "now",
    // Operational focus
    "delivery.staleGithubSignal": "stale GitHub signal",
    "delivery.prMissing": "PR missing",
    "delivery.queueClearTitle": "Delivery queue is clear enough to keep moving",
    "delivery.createFirstStreamTitle": "Create the first delivery stream",
    "delivery.focusBlockedDetail":
      "Project is blocked. Assign a recovery action before starting more delivery work for this account.",
    "delivery.focusMissingRepoDetail":
      "Repository is not linked yet. Connect the project repo before expecting GitHub-native delivery evidence.",
    "delivery.focusQueueClearDetail":
      "No blocked project is first in the queue. Continue with repository verification and active project-manager runs.",
    "delivery.focusNoMemoryDetail":
      "No project memory exists yet. The coordinator should create a project from approved client scope.",
    // Focus signals
    "delivery.signalBlocked": "blocked",
    "delivery.signalRepos": "repos",
    "delivery.signalRuns": "runs",
    // KPI tiles
    "delivery.kpiProjects": "Projects",
    "delivery.kpiProjectsDetail": "Tracked delivery streams",
    "delivery.kpiBlocked": "Blocked",
    "delivery.kpiBlockedDetail": "Needs intervention",
    "delivery.kpiReposLinked": "Repos linked",
    "delivery.kpiReposLinkedDetail": "GitHub native execution",
    // Linked work dashboard
    "delivery.linkedWorkTitle": "Linked Work Dashboard",
    "delivery.linkedWorkSubtitle":
      "Linear issues, runs, PRs, checks, branches, and commits from local evidence.",
    "delivery.linkedWorkEmptyTitle": "No linked work yet",
    "delivery.linkedWorkEmptyDescription":
      "Linear issues, runs, PRs, checks, branches, and commits appear here.",
    // Table columns + cell labels
    "delivery.colRun": "Run",
    "delivery.colRefs": "Refs",
    "delivery.colChecks": "Checks",
    "delivery.branchLabel": "Branch",
    "delivery.commitLabel": "Commit",
    "delivery.ciBadge": "CI",
    "delivery.staleBadge": "Stale",
    "delivery.noPr": "No PR",
    // Project cards + empty state
    "delivery.stackNotSet": "Stack not set",
    "delivery.repositoryPending": "Repository pending",
    "delivery.noProjectsTitle": "No projects yet",
    "delivery.noProjectsDescription":
      "The coordinator creates a project when you describe a client job.",
  },
  it: {
    // Section shell + toolbar
    "delivery.title": "Consegna",
    "delivery.description": "Progetti, repository, stato ed esecuzione del team.",
    "delivery.verifyRepositories": "Verifica repository",
    "delivery.verifying": "Verifica in corso",
    "delivery.verify": "Verifica",
    // Verification banners
    "delivery.verificationFailedTitle": "Verifica dei repository non riuscita",
    "delivery.verificationFailedFallback": "Verifica dei repository non riuscita.",
    "delivery.lastVerificationTitle": "Ultima verifica dei repository",
    "delivery.verified": "verificati",
    "delivery.attention": "da controllare",
    "delivery.unverified": "non verificati",
    "delivery.now": "adesso",
    // Operational focus
    "delivery.staleGithubSignal": "segnale GitHub obsoleto",
    "delivery.prMissing": "PR mancante",
    "delivery.queueClearTitle": "La coda di consegna è abbastanza libera per proseguire",
    "delivery.createFirstStreamTitle": "Crea il primo flusso di consegna",
    "delivery.focusBlockedDetail":
      "Il progetto è bloccato. Assegna un'azione di recupero prima di avviare altro lavoro di consegna per questo cliente.",
    "delivery.focusMissingRepoDetail":
      "Il repository non è ancora collegato. Collega il repo del progetto prima di aspettarti evidenze di consegna native di GitHub.",
    "delivery.focusQueueClearDetail":
      "Nessun progetto bloccato è in cima alla coda. Prosegui con la verifica dei repository e le esecuzioni attive del project manager.",
    "delivery.focusNoMemoryDetail":
      "Non esiste ancora alcuna memoria di progetto. Il coordinatore dovrebbe creare un progetto a partire dallo scope cliente approvato.",
    // Focus signals
    "delivery.signalBlocked": "bloccati",
    "delivery.signalRepos": "repository",
    "delivery.signalRuns": "esecuzioni",
    // KPI tiles
    "delivery.kpiProjects": "Progetti",
    "delivery.kpiProjectsDetail": "Flussi di consegna monitorati",
    "delivery.kpiBlocked": "Bloccati",
    "delivery.kpiBlockedDetail": "Richiede intervento",
    "delivery.kpiReposLinked": "Repository collegati",
    "delivery.kpiReposLinkedDetail": "Esecuzione nativa GitHub",
    // Linked work dashboard
    "delivery.linkedWorkTitle": "Dashboard del lavoro collegato",
    "delivery.linkedWorkSubtitle":
      "Issue Linear, esecuzioni, PR, controlli, branch e commit dalle evidenze locali.",
    "delivery.linkedWorkEmptyTitle": "Nessun lavoro collegato",
    "delivery.linkedWorkEmptyDescription":
      "Issue Linear, esecuzioni, PR, controlli, branch e commit compaiono qui.",
    // Table columns + cell labels
    "delivery.colRun": "Esecuzione",
    "delivery.colRefs": "Riferimenti",
    "delivery.colChecks": "Controlli",
    "delivery.branchLabel": "Branch",
    "delivery.commitLabel": "Commit",
    "delivery.ciBadge": "CI",
    "delivery.staleBadge": "Obsoleti",
    "delivery.noPr": "Nessuna PR",
    // Project cards + empty state
    "delivery.stackNotSet": "Stack non impostato",
    "delivery.repositoryPending": "Repository in attesa",
    "delivery.noProjectsTitle": "Nessun progetto",
    "delivery.noProjectsDescription":
      "Il coordinatore crea un progetto quando descrivi un lavoro per un cliente.",
  },
} satisfies CatalogNamespace;
