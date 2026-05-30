import type { AdaptiveMode } from "./types";

/**
 * Single source of truth for adaptive-mode display names (SER-155).
 *
 * Both the Sidebar and the Header read from this map so a mode is named the
 * same everywhere. The taxonomy mirrors the mode identifiers (e.g. `portfolio`
 * -> "Portfolio", `today` -> "Today") to avoid the earlier drift where the
 * sidebar showed "Home"/"Inbox" while the header showed "Portfolio"/"Today".
 */
export const MODE_LABELS: Record<AdaptiveMode, string> = {
  coordinator: "Coordinator",
  portfolio: "Portfolio",
  today: "Today",
  goals: "Goals",
  revenue: "Revenue",
  delivery: "Delivery",
  growth: "Growth",
  clients: "Clients",
  risk: "Risk",
  approvals: "Approvals",
  memory: "Memory",
  agents: "Agents",
  reports: "Reports",
  settings: "Settings",
};

export function modeLabel(mode: AdaptiveMode): string {
  return MODE_LABELS[mode];
}
