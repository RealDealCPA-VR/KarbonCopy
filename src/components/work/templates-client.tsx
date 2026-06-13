"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileStack, ListChecks, Play, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatMinutes } from "@/lib/utils";
import { applyTemplate } from "@/app/(app)/work/actions";
import type { WorkUser, WorkOrg, WorkStatus } from "./types";

export type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  defaultBudgetMinutes: number | null;
  workTypeName: string | null;
  taskCount: number;
};

const NONE = "__none__";

export function TemplatesClient({
  templates,
  orgs,
  users,
  statuses,
}: {
  templates: TemplateRow[];
  orgs: WorkOrg[];
  users: WorkUser[];
  statuses: WorkStatus[];
}) {
  const router = useRouter();
  const [active, setActive] = React.useState<TemplateRow | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [orgId, setOrgId] = React.useState<string>(NONE);
  const [assigneeId, setAssigneeId] = React.useState<string>(NONE);
  const [start, setStart] = React.useState<string>(() => new Date().toISOString().slice(0, 10));

  function open(t: TemplateRow) {
    setActive(t);
    setOrgId(NONE);
    setAssigneeId(NONE);
    setStart(new Date().toISOString().slice(0, 10));
  }

  function apply() {
    if (!active) return;
    startTransition(async () => {
      try {
        const id = await applyTemplate({
          templateId: active.id,
          organizationId: orgId === NONE ? null : orgId,
          assigneeId: assigneeId === NONE ? null : assigneeId,
          startDate: start || null,
        });
        toast.success(`Created work from "${active.name}"`);
        setActive(null);
        router.push(`/work/${id}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't apply template");
      }
    });
  }

  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed bg-card/50 py-20 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FileStack className="h-7 w-7" />
        </div>
        <h3 className="text-lg font-semibold">No templates yet</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Work templates let you spin up a job and its full checklist in one click. Add them in Settings.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <Card key={t.id} className="flex flex-col transition-shadow hover:shadow-md">
            <CardContent className="flex flex-1 flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileStack className="h-5 w-5" />
                </div>
                {t.workTypeName && <Badge variant="secondary">{t.workTypeName}</Badge>}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">{t.name}</h3>
                {t.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.description}</p>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ListChecks className="h-3.5 w-3.5" /> {t.taskCount} task{t.taskCount === 1 ? "" : "s"}
                </span>
                {t.defaultBudgetMinutes != null && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {formatMinutes(t.defaultBudgetMinutes)}
                  </span>
                )}
              </div>
              <Button className="mt-1 w-full" onClick={() => open(t)}>
                <Play className="h-4 w-4" /> Use template
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!active} onOpenChange={(v) => !v && setActive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply &ldquo;{active?.name}&rdquo;</DialogTitle>
            <DialogDescription>
              Creates a new work item and {active?.taskCount ?? 0} task
              {active?.taskCount === 1 ? "" : "s"} with due dates offset from the start date.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label>Client</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No client</SelectItem>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-start">Start date</Label>
              <Input id="tpl-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={pending}>
              {pending ? "Creating…" : "Create work"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
