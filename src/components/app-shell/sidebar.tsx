"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Briefcase, Users, Inbox, Clock, FolderOpen,
  BellRing, BarChart3, Settings, ShieldCheck, Receipt, CalendarClock,
  FileSignature, ScanLine, Activity, Sparkles, Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/db/schema";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/work", label: "Work", icon: Briefcase },
  { href: "/deadlines", label: "Deadlines", icon: CalendarClock },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/inbox", label: "Triage", icon: Inbox },
  { href: "/time", label: "Time & Budgets", icon: Clock },
  { href: "/billing", label: "Billing", icon: Receipt },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/signatures", label: "Signatures", icon: FileSignature },
  { href: "/intake", label: "Intake", icon: ScanLine },
  { href: "/alerts", label: "File Alerts", icon: BellRing, badge: true },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/anomalies", label: "Anomalies", icon: Activity },
  { href: "/automate", label: "Automate", icon: Sparkles },
  { href: "/integrations", label: "Integrations", icon: Plug },
] as const;

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold tracking-tight">KarbonCopy</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-auto p-3">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {(role === "owner" || role === "admin") && (
        <div className="border-t p-3">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/settings")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      )}
    </aside>
  );
}
