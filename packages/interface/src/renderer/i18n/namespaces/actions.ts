import type { CatalogNamespace } from "../types";

/**
 * Policy action / capability verbs shown to the owner: Settings autonomy and
 * growth toggle rows, and approval-gate titles. Keyed by the normalized
 * snake_case action key (see `lib/status-labels.ts#actionLabel`). Unmapped
 * actions fall back to `formatLabel()` at runtime.
 */
export default {
  en: {
    // Autonomy actions
    "action.observe_signals": "Observe Signals",
    "action.start_triage_runs": "Start Triage Runs",
    "action.create_internal_reports": "Create Internal Reports",
    "action.create_repositories": "Create Repositories",
    "action.create_issues": "Create Issues",
    "action.comment_on_issues": "Comment On Issues",
    "action.create_branches": "Create Branches",
    "action.push_commits": "Push Commits",
    "action.open_pull_requests": "Open Pull Requests",
    "action.merge_pull_requests": "Merge Pull Requests",
    "action.deploy_production": "Deploy Production",
    "action.contact_clients_directly": "Contact Clients Directly",

    // Growth actions
    "action.draft_content": "Draft Content",
    "action.draft_campaigns": "Draft Campaigns",
    "action.draft_replies": "Draft Replies",
    "action.draft_proposals": "Draft Proposals",
    "action.update_internal_pipeline": "Update Internal Pipeline",
    "action.publish_public_content": "Publish Public Content",
    "action.send_client_messages": "Send Client Messages",
    "action.run_paid_ads": "Run Paid Ads",
    "action.change_pricing": "Change Pricing",
    "action.send_final_proposals": "Send Final Proposals",
    "action.accept_projects": "Accept Projects",
    "action.publish_social_posts": "Publish Social Posts",
    "action.generate_public_creatives": "Generate Public Creatives",
    "action.launch_ad_campaigns": "Launch Ad Campaigns",
    "action.change_ad_budget": "Change Ad Budget",
    "action.allow_one_off_owner_approval": "Allow One-Off Owner Approval",
    "action.require_action_sensitive_memory_for_approval":
      "Require Action-Sensitive Memory For Approval",

    // Approval-gated actions
    "action.auth_policy_change": "Auth Policy Change",
    "action.change_billing": "Change Billing",
    "action.delete_data": "Delete Data",
    "action.destructive_db_change": "Destructive DB Change",
    "action.make_legal_commitment": "Make Legal Commitment",
    "action.touch_secrets": "Touch Secrets",
  },
  it: {
    // Autonomy actions
    "action.observe_signals": "Osserva i segnali",
    "action.start_triage_runs": "Avvia esecuzioni di triage",
    "action.create_internal_reports": "Crea report interni",
    "action.create_repositories": "Crea repository",
    "action.create_issues": "Crea issue",
    "action.comment_on_issues": "Commenta le issue",
    "action.create_branches": "Crea branch",
    "action.push_commits": "Esegui push dei commit",
    "action.open_pull_requests": "Apri pull request",
    "action.merge_pull_requests": "Unisci pull request",
    "action.deploy_production": "Distribuisci in produzione",
    "action.contact_clients_directly": "Contatta i clienti direttamente",

    // Growth actions
    "action.draft_content": "Crea bozze di contenuti",
    "action.draft_campaigns": "Crea bozze di campagne",
    "action.draft_replies": "Crea bozze di risposte",
    "action.draft_proposals": "Crea bozze di proposte",
    "action.update_internal_pipeline": "Aggiorna la pipeline interna",
    "action.publish_public_content": "Pubblica contenuti pubblici",
    "action.send_client_messages": "Invia messaggi ai clienti",
    "action.run_paid_ads": "Avvia annunci a pagamento",
    "action.change_pricing": "Modifica i prezzi",
    "action.send_final_proposals": "Invia proposte definitive",
    "action.accept_projects": "Accetta progetti",
    "action.publish_social_posts": "Pubblica post sui social",
    "action.generate_public_creatives": "Genera creatività pubbliche",
    "action.launch_ad_campaigns": "Lancia campagne pubblicitarie",
    "action.change_ad_budget": "Modifica il budget pubblicitario",
    "action.allow_one_off_owner_approval": "Consenti approvazione una tantum del titolare",
    "action.require_action_sensitive_memory_for_approval":
      "Richiedi memoria sensibile all'azione per l'approvazione",

    // Approval-gated actions
    "action.auth_policy_change": "Modifica policy di autenticazione",
    "action.change_billing": "Modifica fatturazione",
    "action.delete_data": "Elimina dati",
    "action.destructive_db_change": "Modifica distruttiva del database",
    "action.make_legal_commitment": "Assumi impegni legali",
    "action.touch_secrets": "Accedi ai segreti",
  },
} satisfies CatalogNamespace;
