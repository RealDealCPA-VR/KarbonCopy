"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMinutes, initials, colorForId } from "@/lib/utils";
import { ExportCsvButton } from "./export-csv";
import { PERIOD_LABELS, type Period, type StaffRow } from "./types";

function utilTone(pct: number | null): "success" | "warning" | "destructive" | "secondary" {
  if (pct == null) return "secondary";
  if (pct > 110) return "destructive";
  if (pct >= 85) return "warning";
  if (pct >= 40) return "success";
  return "secondary";
}

export function StaffTable({ rows, period }: { rows: StaffRow[]; period: Period }) {
  const csvHeaders = [
    "Staff",
    "Open",
    "Overdue",
    `Completed (${PERIOD_LABELS[period]})`,
    "Logged hours",
    "Capacity hours",
    "Utilization %",
  ];
  const csvRows = rows.map((r) => [
    r.name,
    r.open,
    r.overdue,
    r.completedThisPeriod,
    (r.loggedMinutes / 60).toFixed(1),
    (r.capacityMinutes / 60).toFixed(1),
    r.utilizationPct == null ? "" : r.utilizationPct,
  ]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>By staff member</CardTitle>
        <ExportCsvButton filename="karboncopy-staff.csv" headers={csvHeaders} rows={csvRows} />
      </CardHeader>
      <CardContent className="px-2">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No active staff to report.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Logged</TableHead>
                <TableHead className="w-[150px]">Utilization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const pct = r.utilizationPct;
                return (
                  <TableRow key={r.userId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                          style={{ background: r.color || colorForId(r.userId) }}
                        >
                          {initials(r.name)}
                        </span>
                        <span className="truncate font-medium">{r.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.open}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.overdue > 0 ? (
                        <span className="font-medium text-destructive">{r.overdue}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.completedThisPeriod}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMinutes(r.loggedMinutes)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(pct ?? 0, 100)}%`,
                              background:
                                pct == null
                                  ? "hsl(var(--muted-foreground))"
                                  : pct > 110
                                    ? "hsl(var(--destructive))"
                                    : pct >= 85
                                      ? "hsl(var(--warning))"
                                      : "hsl(var(--success))",
                            }}
                          />
                        </div>
                        <Badge variant={utilTone(pct)} className="w-14 justify-center tabular-nums">
                          {pct == null ? "—" : `${pct}%`}
                        </Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
