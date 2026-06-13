import Link from "next/link";
import { ShieldCheck, FileText, FileBox, Receipt, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/portal/(client)/actions";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const NAV: NavItem[] = [
  { href: "/portal/dashboard", label: "Overview", icon: FileText },
  { href: "/portal/documents", label: "Documents", icon: FileBox },
  { href: "/portal/invoices", label: "Invoices", icon: Receipt },
];

/**
 * Shared portal chrome for the authenticated (client) area: brand row, primary
 * nav, and a sign-out button (server-action form). `active` highlights the
 * current section.
 */
export function PortalHeader({
  firmName,
  clientName,
  active,
}: {
  firmName?: string | null;
  clientName?: string | null;
  active?: "dashboard" | "documents" | "invoices";
}) {
  return (
    <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <Link href="/portal/dashboard" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            {firmName ?? "Client Portal"}
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 sm:flex">
          {NAV.map((item) => {
            const isActive =
              (active === "dashboard" && item.href === "/portal/dashboard") ||
              (active === "documents" && item.href === "/portal/documents") ||
              (active === "invoices" && item.href === "/portal/invoices");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {clientName && (
            <span className="hidden text-sm text-muted-foreground md:inline">{clientName}</span>
          )}
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </form>
        </div>
      </div>

      {/* Mobile nav row */}
      <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
        {NAV.map((item) => {
          const isActive =
            (active === "dashboard" && item.href === "/portal/dashboard") ||
            (active === "documents" && item.href === "/portal/documents") ||
            (active === "invoices" && item.href === "/portal/invoices");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
