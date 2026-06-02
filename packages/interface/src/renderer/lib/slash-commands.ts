export interface SlashCommand {
  id: string;
  trigger: string;
  labelKey: string;
  fallbackLabel: string;
  /** Prompt scaffold inserted into the composer when the command is chosen. */
  template: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "client", trigger: "/client", labelKey: "slash.client", fallbackLabel: "New client intake", template: "New client: " },
  { id: "project", trigger: "/project", labelKey: "slash.project", fallbackLabel: "New project", template: "New project: " },
  { id: "proposal", trigger: "/proposal", labelKey: "slash.proposal", fallbackLabel: "Draft a proposal", template: "Draft a proposal for " },
  { id: "run", trigger: "/run", labelKey: "slash.run", fallbackLabel: "Dispatch a run", template: "Dispatch a run: " },
  { id: "approvals", trigger: "/approvals", labelKey: "slash.approvals", fallbackLabel: "Review pending approvals", template: "Review pending approvals" },
];

export interface SlashQuery {
  isSlash: boolean;
  query: string;
}

export function parseSlash(value: string): SlashQuery {
  if (!value.startsWith("/")) return { isSlash: false, query: "" };
  if (value.includes(" ")) return { isSlash: false, query: "" };
  return { isSlash: true, query: value.slice(1).toLowerCase() };
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.trigger.slice(1).includes(q) || c.fallbackLabel.toLowerCase().includes(q),
  );
}
