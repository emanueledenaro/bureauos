import {
  Activity,
  BarChart3,
  Bot,
  Box,
  Briefcase,
  FileText,
  Home,
  Inbox,
  Database,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { AdaptiveMode, DashboardState } from "../../lib/types";
import { Badge } from "../ui/badge";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";

interface NavItem {
  id: AdaptiveMode;
  label: string;
  icon: LucideIcon;
  badgeKey?: keyof BadgeData;
}

interface BadgeData {
  projects: number;
  opportunities: number;
  clients: number;
  risk: number;
  artifacts: number;
  agents: number;
  runs: number;
  approvals: number;
}

const PRIMARY: NavItem[] = [
  { id: "portfolio", label: "Home", icon: Home },
  { id: "revenue", label: "Revenue", icon: Wallet },
  { id: "delivery", label: "Delivery", icon: Briefcase, badgeKey: "projects" },
  { id: "growth", label: "Growth", icon: TrendingUp, badgeKey: "opportunities" },
  { id: "clients", label: "Clients", icon: Users, badgeKey: "clients" },
  { id: "risk", label: "Risk", icon: ShieldAlert, badgeKey: "risk" },
  { id: "memory", label: "Memory", icon: Database, badgeKey: "artifacts" },
  { id: "agents", label: "Agents", icon: Bot, badgeKey: "agents" },
];

const SECONDARY: NavItem[] = [
  { id: "today", label: "Inbox", icon: Inbox, badgeKey: "runs" },
  { id: "approvals", label: "Approvals", icon: ShieldCheck, badgeKey: "approvals" },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function computeBadges(state: DashboardState): BadgeData {
  return {
    projects: state.projects.length,
    opportunities: state.opportunities.length,
    clients: state.clients.length,
    risk:
      state.approvals.length +
      state.projects.filter((project) => project.status === "blocked").length,
    artifacts: state.artifacts.length,
    agents: state.agents.length,
    runs: state.runs.length,
    approvals: state.approvals.length,
  };
}

function SidebarContent({
  state,
  mode,
  onModeChange,
}: {
  state: DashboardState;
  mode: AdaptiveMode;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  const badges = computeBadges(state);
  const systemHealthy = !state.error && !state.loading;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-border/60 px-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.2)]">
          <Box className="h-4 w-4" strokeWidth={2.5} />
        </div>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold text-foreground">BureauOS</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Operating Room
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          {PRIMARY.map((item) => (
            <SidebarItem
              key={item.id}
              item={item}
              active={mode === item.id}
              badge={item.badgeKey ? badges[item.badgeKey] : undefined}
              onClick={() => onModeChange(item.id)}
            />
          ))}
        </div>

        <div className="my-4 border-t border-border/60" />

        <div className="space-y-0.5">
          {SECONDARY.map((item) => (
            <SidebarItem
              key={item.id}
              item={item}
              active={mode === item.id}
              badge={item.badgeKey ? badges[item.badgeKey] : undefined}
              onClick={() => onModeChange(item.id)}
            />
          ))}
        </div>
      </nav>

      <div className="m-3 rounded-lg border border-border/60 bg-surface-subtle p-3">
        <div className="flex items-center justify-between">
          <div className="label-eyebrow">System Status</div>
          <Activity className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              systemHealthy
                ? "bg-success shadow-[0_0_8px_hsl(var(--success)/0.6)]"
                : state.loading
                  ? "bg-warning"
                  : "bg-danger",
            )}
          />
          <span className="text-foreground">
            {state.error ? "API offline" : state.loading ? "Connecting" : "All systems online"}
          </span>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {state.agents.length} agents · {state.runs.length} runs
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  state,
  mode,
  onModeChange,
}: {
  state: DashboardState;
  mode: AdaptiveMode;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  return (
    <aside className="hidden h-full w-[208px] shrink-0 border-r border-border/60 bg-surface lg:flex lg:flex-col">
      <SidebarContent state={state} mode={mode} onModeChange={onModeChange} />
    </aside>
  );
}

export function SidebarDrawer({
  state,
  mode,
  open,
  onOpenChange,
  onModeChange,
}: {
  state: DashboardState;
  mode: AdaptiveMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[260px] p-0" hideClose>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarContent
          state={state}
          mode={mode}
          onModeChange={(next) => {
            onModeChange(next);
            onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function SidebarItem({
  item,
  active,
  badge,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex h-9 w-full items-center justify-between rounded-md px-2.5 text-left text-[12px] transition-colors focus-ring",
        active
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Icon
          className={cn(
            "h-4 w-4 transition-colors",
            active ? "text-foreground" : "text-muted-foreground/80 group-hover:text-foreground",
          )}
        />
        <span className="font-medium">{item.label}</span>
      </div>
      {badge !== undefined && badge > 0 ? (
        <Badge
          variant={active ? "secondary" : "outline"}
          className="h-4 min-w-[18px] justify-center px-1 text-[9px]"
        >
          {badge}
        </Badge>
      ) : null}
    </button>
  );
}
