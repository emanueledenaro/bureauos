import {
  Bot,
  ChevronRight,
  Code2,
  FileText,
  type LucideIcon,
  MegaphoneIcon,
  Palette,
  Scale,
  ShieldAlert,
  Sparkles,
  TestTube2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { agentAbbr } from "../../lib/tone";
import { formatLabel } from "../../lib/format";
import type { AgentDefinition } from "../../lib/api";

const ROLE_ICON: Record<string, LucideIcon> = {
  project_manager: Users,
  product_manager: Sparkles,
  ux_designer: Palette,
  developer: Code2,
  development: Code2,
  qa: TestTube2,
  quality_assurance: TestTube2,
  compliance: Scale,
  legal: Scale,
  growth: MegaphoneIcon,
  marketing: MegaphoneIcon,
  sales: Users,
  security: ShieldAlert,
  ads: MegaphoneIcon,
  content: FileText,
};

function roleIcon(role: string): LucideIcon {
  return ROLE_ICON[role.toLowerCase()] ?? Bot;
}

export function AgentLayer({ agents }: { agents: AgentDefinition[] }) {
  const [open, setOpen] = useState(false);
  const visible = agents.slice(0, 10);
  return (
    <section className="border-t border-border/60 bg-surface px-3 py-2 sm:px-5">
      <div className="flex items-center gap-3 sm:hidden">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between"
          onClick={() => setOpen(true)}
        >
          <span className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5" />
            Agent Layer
          </span>
          <span className="text-muted-foreground">{agents.length}</span>
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[78vh] rounded-t-xl p-0">
            <SheetHeader>
              <SheetTitle>Agent Layer</SheetTitle>
              <SheetDescription>{agents.length} autonomous roles available.</SheetDescription>
            </SheetHeader>
            <div className="grid max-h-[56vh] gap-2 overflow-y-auto px-4 py-4">
              {agents.length > 0 ? (
                agents.map((agent) => {
                  const Icon = roleIcon(agent.role);
                  return (
                    <div
                      key={agent.id}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-subtle p-3"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-raised text-foreground">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-semibold text-foreground">
                          {formatLabel(agent.role)}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {agent.category}
                        </div>
                      </div>
                      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-lg border border-border/60 bg-surface-subtle p-3 text-[11px] text-muted-foreground">
                  No agents loaded
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <div className="hidden h-10 items-center gap-4 sm:flex">
        <div className="hidden min-w-[180px] md:block">
          <div className="text-[12px] font-semibold text-foreground">Agent Layer</div>
          <div className="text-[10px] text-muted-foreground">{agents.length} autonomous roles</div>
        </div>
        <div className="flex flex-1 items-center gap-2 overflow-x-auto no-scrollbar gradient-mask-fade">
          {visible.length > 0 ? (
            visible.map((agent) => {
              const Icon = roleIcon(agent.role);
              return (
                <Tooltip key={agent.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex h-10 shrink-0 items-center gap-2 rounded-full border border-border/60 bg-surface-subtle px-3 transition-colors hover:border-border hover:bg-surface-raised focus-ring",
                      )}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-raised text-foreground">
                        <Icon className="h-3 w-3" />
                      </span>
                      <div className="text-left leading-tight">
                        <div className="text-[11px] font-medium text-foreground">
                          {agentAbbr(agent.role) || "AG"}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {formatLabel(agent.role)}
                        </div>
                      </div>
                      <span className="ml-1 h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="font-medium">{formatLabel(agent.role)}</div>
                    <div className="mt-0.5 text-muted-foreground">{agent.category}</div>
                  </TooltipContent>
                </Tooltip>
              );
            })
          ) : (
            <div className="text-[11px] text-muted-foreground">No agents loaded</div>
          )}
        </div>
        <Button variant="outline" size="sm" className="shrink-0">
          Manage agents
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </section>
  );
}
