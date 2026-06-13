import Link from "next/link";
import { format } from "date-fns";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { eventLabel, metaFor } from "./severity";
import type { AlertItem } from "./types";

const statusBadge: Record<AlertItem["status"], "secondary" | "success" | "outline"> = {
  new: "secondary",
  acknowledged: "success",
  dismissed: "outline",
};

export function AuditLog({ rows }: { rows: AlertItem[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> Audit log
          </CardTitle>
          <CardDescription>Complete record of file-server events (last {rows.length}).</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead className="hidden md:table-cell">Client</TableHead>
                  <TableHead className="hidden lg:table-cell">Rule</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const meta = metaFor(r.severity);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-[260px]">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                          <span className="truncate font-medium" title={r.filePath}>
                            {r.fileName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {r.clientName ? (
                          r.organizationId ? (
                            <Link
                              href={`/clients/${r.organizationId}`}
                              className="text-sm hover:text-primary hover:underline"
                            >
                              {r.clientName}
                            </Link>
                          ) : (
                            <span className="text-sm">{r.clientName}</span>
                          )
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {r.ruleName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {eventLabel(r.event)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadge[r.status]} className="capitalize">
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm text-muted-foreground tabular-nums">
                        {format(new Date(r.detectedAt), "MMM d, h:mm a")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
