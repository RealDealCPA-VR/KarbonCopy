import Link from "next/link";
import { and, desc, eq, gte, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Briefcase, AlertTriangle, CheckCircle2, Clock, BellRing, ArrowRight, Users,
} from "lucide-react";
import { formatDistanceToNow, isToday } from "date-fns";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const now = new Date();
  const soon = new Date(Date.now() + 7 * 86400_000);

  const [openWork, overdue, dueThisWeek, clients, recentFiles, myWork] = await Promise.all([
    db.select().from(schema.workItems).where(isNull(schema.workItems.completedAt)),
    db
      .select()
      .from(schema.workItems)
      .where(and(isNull(schema.workItems.completedAt), isNotNull(schema.workItems.dueDate), lte(schema.workItems.dueDate, now))),
    db
      .select()
      .from(schema.workItems)
      .where(and(isNull(schema.workItems.completedAt), isNotNull(schema.workItems.dueDate), gte(schema.workItems.dueDate, now), lte(schema.workItems.dueDate, soon))),
    db.select().from(schema.organizations).where(and(eq(schema.organizations.isClient, true), isNull(schema.organizations.deletedAt))),
    db.select().from(schema.fileEvents).orderBy(desc(schema.fileEvents.detectedAt)).limit(6),
    user
      ? db
          .select()
          .from(schema.workItems)
          .where(and(eq(schema.workItems.assigneeId, user.id), isNull(schema.workItems.completedAt)))
          .orderBy(desc(schema.workItems.dueDate))
          .limit(8)
      : Promise.resolve([]),
  ]);

  const stats = [
    { label: "Open work", value: openWork.length, icon: Briefcase, href: "/work", tone: "default" as const },
    { label: "Overdue", value: overdue.length, icon: AlertTriangle, href: "/work?filter=overdue", tone: "destructive" as const },
    { label: "Due this week", value: dueThisWeek.length, icon: Clock, href: "/work?filter=week", tone: "warning" as const },
    { label: "Active clients", value: clients.length, icon: Users, href: "/clients", tone: "default" as const },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s happening across your firm.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-4 p-5">
                <div
                  className={
                    "flex h-11 w-11 items-center justify-center rounded-lg " +
                    (s.tone === "destructive"
                      ? "bg-destructive/10 text-destructive"
                      : s.tone === "warning"
                        ? "bg-warning/15 text-warning"
                        : "bg-primary/10 text-primary")
                  }
                >
                  <s.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold tabular-nums">{s.value}</div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>My work</CardTitle>
            <Link href="/work" className="text-sm text-primary hover:underline">
              View all <ArrowRight className="inline h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {myWork.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing assigned to you. Enjoy the calm. ☕
              </p>
            ) : (
              myWork.map((w) => {
                const od = w.dueDate && w.dueDate < now;
                return (
                  <Link
                    key={w.id}
                    href={`/work/${w.id}`}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent"
                  >
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm font-medium">{w.title}</span>
                    {w.dueDate && (
                      <Badge variant={od ? "destructive" : isToday(w.dueDate) ? "warning" : "secondary"}>
                        {od ? "Overdue" : formatDistanceToNow(w.dueDate, { addSuffix: true })}
                      </Badge>
                    )}
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-4 w-4" /> File alerts
            </CardTitle>
            <Link href="/alerts" className="text-sm text-primary hover:underline">
              All
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentFiles.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No file activity yet. Configure watched folders in Settings.
              </p>
            ) : (
              recentFiles.map((f) => (
                <div key={f.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-success" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{f.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(f.detectedAt), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
