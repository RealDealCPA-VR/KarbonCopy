"use client";

import * as React from "react";
import Link from "next/link";
import { Mail, Phone, Search, Star, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "./user-avatar";

export type PersonRow = {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  portalEnabled: boolean;
  organizationId: string | null;
  orgName: string | null;
};

export function PeopleSearch({ people }: { people: PersonRow[] }) {
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [`${p.firstName} ${p.lastName}`, p.email ?? "", p.title ?? "", p.orgName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [people, query]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people, email, client…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <Users className="h-7 w-7" />
            {people.length === 0 ? "No contacts yet." : "No people match your search."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Card key={p.id} className="transition-shadow hover:shadow-md">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <UserAvatar
                    user={{ id: p.id, name: `${p.firstName} ${p.lastName}` }}
                    className="h-10 w-10"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">
                        {p.firstName} {p.lastName}
                      </span>
                      {p.isPrimary && (
                        <Badge variant="warning" className="gap-1">
                          <Star className="h-3 w-3" /> Primary
                        </Badge>
                      )}
                    </div>
                    {p.title && <div className="truncate text-sm text-muted-foreground">{p.title}</div>}
                    {p.orgName && p.organizationId && (
                      <Link
                        href={`/clients/${p.organizationId}`}
                        className="text-xs text-primary hover:underline"
                      >
                        {p.orgName}
                      </Link>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5 text-sm">
                  {p.email && (
                    <a href={`mailto:${p.email}`} className="flex items-center gap-2 text-muted-foreground hover:text-primary">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{p.email}</span>
                    </a>
                  )}
                  {p.phone && (
                    <a href={`tel:${p.phone}`} className="flex items-center gap-2 text-muted-foreground hover:text-primary">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{p.phone}</span>
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
