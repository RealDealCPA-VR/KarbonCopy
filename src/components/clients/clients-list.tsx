"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Plus, Search, Users, LayoutGrid, List } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, colorForId } from "@/lib/utils";
import { ENTITY_TYPES, entityTypeShort, formatFiscalYearEnd } from "./entity-types";
import { OrgDialog } from "./org-dialog";
import { UserAvatar } from "./user-avatar";
import type { EntityType, Organization } from "@/db/schema";

export type ClientRow = Organization & {
  ownerName: string | null;
  ownerImage: string | null;
  ownerColor: string | null;
  openWork: number;
  contactCount: number;
};

type UserLite = { id: string; name: string };

export function ClientsList({
  clients,
  users,
  openCreate,
}: {
  clients: ClientRow[];
  users: UserLite[];
  openCreate?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = React.useState("");
  const [entityFilter, setEntityFilter] = React.useState<EntityType | "all">("all");
  const [ownerFilter, setOwnerFilter] = React.useState<string>("all");
  const [view, setView] = React.useState<"grid" | "table">("grid");
  const [dialogOpen, setDialogOpen] = React.useState(Boolean(openCreate));

  // If arriving with ?new=1, open the dialog then strip the param.
  React.useEffect(() => {
    if (openCreate) {
      setDialogOpen(true);
      router.replace("/clients");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreate]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (entityFilter !== "all" && c.entityType !== entityFilter) return false;
      if (ownerFilter !== "all") {
        if (ownerFilter === "none" ? c.ownerId != null : c.ownerId !== ownerFilter) return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.ownerName ?? "").toLowerCase().includes(q)
      );
    });
  }, [clients, query, entityFilter, ownerFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground">
            {clients.length} {clients.length === 1 ? "organization" : "organizations"} on your roster
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/clients/people">
              <Users className="h-4 w-4" /> People
            </Link>
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> New client
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients, email, manager…"
            className="pl-9"
          />
        </div>

        <Select value={entityFilter} onValueChange={(v) => setEntityFilter(v as EntityType | "all")}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Entity type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entity types</SelectItem>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Manager" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All managers</SelectItem>
            <SelectItem value="none">Unassigned</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center rounded-lg border p-0.5">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setView("grid")}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setView("table")}
            aria-label="Table view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          hasClients={clients.length > 0}
          onCreate={() => setDialogOpen(true)}
        />
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <ClientCard key={c.id} client={c} />
          ))}
        </div>
      ) : (
        <ClientTable clients={filtered} />
      )}

      <OrgDialog open={dialogOpen} onOpenChange={setDialogOpen} users={users} />
    </div>
  );
}

function ClientCard({ client: c }: { client: ClientRow }) {
  const accent = colorForId(c.id);
  return (
    <Link href={`/clients/${c.id}`} className="group block">
      <Card className="h-full overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
        <div className="h-1" style={{ backgroundColor: accent }} />
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold group-hover:text-primary">{c.name}</div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary">{entityTypeShort(c.entityType)}</Badge>
                {c.fiscalYearEnd ? (
                  <span className="text-xs text-muted-foreground">
                    FYE {formatFiscalYearEnd(c.fiscalYearEnd)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              {c.ownerName ? (
                <>
                  <UserAvatar
                    user={{ id: c.ownerId!, name: c.ownerName, image: c.ownerImage, color: c.ownerColor }}
                    className="h-6 w-6"
                  />
                  <span className="truncate">{c.ownerName}</span>
                </>
              ) : (
                <span className="italic">No manager</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
              <span className={cn(c.openWork > 0 && "font-medium text-foreground")}>
                {c.openWork} open
              </span>
              <span>{c.contactCount} contacts</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ClientTable({ clients }: { clients: ClientRow[] }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 font-medium">Client</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Manager</th>
              <th className="px-5 py-3 text-right font-medium">Open work</th>
              <th className="px-5 py-3 text-right font-medium">Contacts</th>
              <th className="px-5 py-3 font-medium">FYE</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr
                key={c.id}
                className="border-b last:border-0 transition-colors hover:bg-accent/50"
              >
                <td className="px-5 py-3">
                  <Link href={`/clients/${c.id}`} className="font-medium hover:text-primary">
                    {c.name}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <Badge variant="secondary">{entityTypeShort(c.entityType)}</Badge>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{c.ownerName ?? "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums">{c.openWork}</td>
                <td className="px-5 py-3 text-right tabular-nums">{c.contactCount}</td>
                <td className="px-5 py-3 text-muted-foreground">
                  {formatFiscalYearEnd(c.fiscalYearEnd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function EmptyState({
  hasClients,
  onCreate,
}: {
  hasClients: boolean;
  onCreate: () => void;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Building2 className="h-7 w-7" />
        </div>
        <div>
          <p className="font-semibold">
            {hasClients ? "No clients match your filters" : "No clients yet"}
          </p>
          <p className="text-sm text-muted-foreground">
            {hasClients
              ? "Try clearing your search or filters."
              : "Add your first client to start tracking work, contacts, and documents."}
          </p>
        </div>
        {!hasClients && (
          <Button onClick={onCreate} className="mt-1">
            <Plus className="h-4 w-4" /> New client
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
