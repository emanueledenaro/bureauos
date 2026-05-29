import type { ClientRecord } from "./api";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export function projectTone(status: string): Tone {
  if (status === "blocked" || status === "cancelled") return "danger";
  if (status === "proposal" || status === "approved" || status === "intake") return "warning";
  if (status === "delivered" || status === "in_progress") return "success";
  return "neutral";
}

export function projectProgress(status: string): number {
  switch (status) {
    case "intake":
      return 15;
    case "proposal":
      return 30;
    case "approved":
      return 45;
    case "in_progress":
      return 65;
    case "blocked":
      return 35;
    case "delivered":
      return 100;
    case "cancelled":
      return 0;
    default:
      return 20;
  }
}

export function opportunityTone(status: string): Tone {
  if (status === "lost") return "danger";
  if (status === "stalled" || status === "proposal_draft" || status === "proposal_sent") {
    return "warning";
  }
  if (status === "won" || status === "qualified") return "success";
  return "neutral";
}

export function opportunityProgress(status: string): number {
  switch (status) {
    case "intake":
      return 15;
    case "qualified":
      return 35;
    case "proposal_draft":
      return 50;
    case "proposal_sent":
      return 70;
    case "won":
      return 100;
    case "lost":
      return 0;
    case "stalled":
      return 30;
    default:
      return 20;
  }
}

export function clientRiskTone(risk: string): Tone {
  if (risk === "blocked") return "danger";
  if (risk === "follow_up_due" || risk === "proposal") return "warning";
  if (risk === "active") return "success";
  return "neutral";
}

export function runTone(status: string): Tone {
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "needs_human") return "warning";
  if (status === "completed") return "success";
  return "neutral";
}

export function approvalTone(status: string): Tone {
  if (status === "approved") return "success";
  if (status === "rejected" || status === "expired") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

export function progressTone(progress: number): Tone {
  if (progress >= 80) return "success";
  if (progress >= 45) return "warning";
  if (progress > 0) return "danger";
  return "neutral";
}

export function actionStateLabel(tone: Tone): string {
  if (tone === "danger") return "urgent";
  if (tone === "warning") return "review";
  if (tone === "success") return "clear";
  if (tone === "info") return "info";
  return "watch";
}

export function agentAbbr(role: string): string {
  if (!role) return "";
  return role
    .split(/[_\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

export function isInternalClient(client?: ClientRecord): boolean {
  if (!client) return false;
  const value = `${client.name} ${client.industry}`.toLowerCase();
  return value.includes("bureauos") || value.includes("internal");
}

export function displayLaneLabel(client?: ClientRecord): { label: string; subtitle: string } {
  if (!client) return { label: "Unassigned", subtitle: "No client memory" };
  if (isInternalClient(client)) {
    return { label: "Internal Product", subtitle: client.name };
  }
  return {
    label: client.name,
    subtitle: client.industry || "Client",
  };
}

export const toneIndicatorClass: Record<Tone, string> = {
  success: "bg-success shadow-[0_0_10px_hsl(var(--success)/0.55)]",
  warning: "bg-warning shadow-[0_0_10px_hsl(var(--warning)/0.45)]",
  danger: "bg-danger shadow-[0_0_10px_hsl(var(--danger)/0.55)]",
  info: "bg-info shadow-[0_0_10px_hsl(var(--info)/0.5)]",
  neutral: "bg-muted-foreground/60",
};

export const toneTextClass: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-muted-foreground",
};

export const toneProgressClass: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground/40",
};

export const toneBadgeVariant: Record<Tone, "success" | "warning" | "danger" | "info" | "muted"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  neutral: "muted",
};
