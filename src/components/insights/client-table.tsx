"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinutes, formatMoneyCents } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ExportCsvButton } from "./export-csv";
import type { ClientRow } from "./types";

export function ClientTable({ rows }: { rows: ClientRow[] }) {
  const csvHeaders = ["Client", "Open work", "WIP value (USD)", "Logged hours", "Last activity"];
  const csvRows = rows.map((r) => [
    r.name,
    r.openWork,
    (r.wipValueCents / 100).toFixed(2),
    (r.loggedMinutes / 60).toFixed(1),
    r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : "",
  ]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>By client</CardTitle>
        <ExportCsvButton filename="karboncopy-clients.csv" headers={csvHeaders} rows={csvRows} />
      </CardHeader>
      <CardContent className="px-2">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No client activity to report.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">WIP value</TableHead>
                <TableHead className="text-right">Logged</TableHead>
                <TableHead className="text-right">Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.orgId}>
                  <TableCell>
                    <Link
                      href={`/clients/${r.orgId}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.openWork}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoneyCents(r.wipValueCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMinutes(r.loggedMinutes)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {r.lastActivityAt
                      ? formatDistanceToNow(new Date(r.lastActivityAt), { addSuffix: true })
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
