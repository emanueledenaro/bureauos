import { filterSlashCommands, type SlashCommand } from "../../lib/slash-commands";
import { useT } from "../../i18n/i18n";

/**
 * Renders the filtered slash-command list above the composer. The composer owns the
 * open/close decision (via parseSlash) and applies the chosen command's template.
 */
export function SlashCommandMenu({
  query,
  onPick,
}: {
  query: string;
  onPick: (command: SlashCommand) => void;
}) {
  const t = useT();
  const commands = filterSlashCommands(query);
  if (commands.length === 0) return null;
  return (
    <div
      role="menu"
      className="mb-2 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg"
    >
      {commands.map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitem"
          className="text-body-secondary block w-full rounded px-2 py-1.5 text-left hover:bg-surface-subtle"
          onClick={() => onPick(c)}
        >
          <span className="font-mono text-foreground">{c.trigger}</span>{" "}
          <span className="text-muted-foreground">{t(c.labelKey, c.fallbackLabel)}</span>
        </button>
      ))}
    </div>
  );
}
