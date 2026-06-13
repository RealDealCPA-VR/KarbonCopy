"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  LayoutDashboard, Briefcase, Users, Inbox, Clock, FolderOpen, BellRing, BarChart3, Settings, Plus,
  Receipt, CalendarClock, FileSignature, ScanLine, Activity, Sparkles, Plug,
} from "lucide-react";

const PAGES = [
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
  { href: "/alerts", label: "File Alerts", icon: BellRing },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/anomalies", label: "Anomalies", icon: Activity },
  { href: "/automate", label: "Automate", icon: Sparkles },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

const ACTIONS = [
  { href: "/work?new=1", label: "New work item", icon: Plus },
  { href: "/clients?new=1", label: "New client", icon: Plus },
  { href: "/billing/new", label: "New invoice", icon: Plus },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Quick actions">
          {ACTIONS.map((a) => (
            <CommandItem key={a.label} onSelect={() => go(a.href)}>
              <a.icon /> {a.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Navigate">
          {PAGES.map((p) => (
            <CommandItem key={p.href} onSelect={() => go(p.href)}>
              <p.icon /> {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
