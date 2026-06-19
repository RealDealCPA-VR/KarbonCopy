"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { saveWorkItem, type WorkItemInput } from "@/app/(app)/work/actions";
import { PRIORITY_LABELS } from "./types";
import type { WorkUser, WorkOrg, WorkContact, WorkTypeLite, WorkStatus, WorkItem, WorkPriority } from "./types";

const UNASSIGNED = "__none__";

function toInputDate(d: Date | number | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function WorkDialog({
  open,
  onOpenChange,
  item,
  users,
  orgs,
  contacts,
  workTypes,
  statuses,
  defaultStatusId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item?: WorkItem | null;
  users: WorkUser[];
  orgs: WorkOrg[];
  contacts: WorkContact[];
  workTypes: WorkTypeLite[];
  statuses: WorkStatus[];
  defaultStatusId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [form, setForm] = React.useState<WorkItemInput>(() => initial());

  function initial(): WorkItemInput {
    return {
      id: item?.id,
      title: item?.title ?? "",
      description: item?.description ?? "",
      workTypeId: item?.workTypeId ?? null,
      statusId: item?.statusId ?? defaultStatusId ?? statuses[0]?.id ?? null,
      priority: (item?.priority as WorkPriority) ?? "normal",
      organizationId: item?.organizationId ?? null,
      contactId: item?.contactId ?? null,
      assigneeId: item?.assigneeId ?? null,
      startDate: toInputDate(item?.startDate),
      dueDate: toInputDate(item?.dueDate),
      budgetMinutes: item?.budgetMinutes ?? "",
    };
  }

  // Reset the form whenever the dialog opens or the target item changes.
  React.useEffect(() => {
    if (open) setForm(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  function set<K extends keyof WorkItemInput>(key: K, value: WorkItemInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Contacts available for the currently-selected client (organization). When
  // no client is selected we show all contacts so the field is still usable.
  const availableContacts = React.useMemo(() => {
    if (!form.organizationId) return contacts;
    return contacts.filter((c) => c.organizationId === form.organizationId);
  }, [contacts, form.organizationId]);

  function onOrgChange(orgId: string | null) {
    setForm((f) => {
      // If the linked contact no longer belongs to the new org, clear it.
      const keepContact =
        f.contactId == null ||
        !orgId ||
        contacts.some((c) => c.id === f.contactId && c.organizationId === orgId);
      return { ...f, organizationId: orgId, contactId: keepContact ? f.contactId : null };
    });
  }

  function onWorkTypeChange(id: string) {
    const wt = workTypes.find((w) => w.id === id);
    setForm((f) => ({
      ...f,
      workTypeId: id,
      // Prefill budget from the work type default when empty.
      budgetMinutes:
        (f.budgetMinutes === "" || f.budgetMinutes == null) && wt?.defaultBudgetMinutes != null
          ? wt.defaultBudgetMinutes
          : f.budgetMinutes,
    }));
  }

  function submit() {
    if (!form.title?.trim()) {
      toast.error("Please enter a title");
      return;
    }
    startTransition(async () => {
      try {
        await saveWorkItem(form);
        toast.success(item ? "Work updated" : "Work created");
        onOpenChange(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? "Edit work" : "New work"}</DialogTitle>
          <DialogDescription>
            {item ? "Update the details of this engagement." : "Create a new job, return, or task."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="wd-title">Title</Label>
            <Input
              id="wd-title"
              autoFocus
              placeholder="e.g. 2024 Form 1120S — Acme Inc."
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Work type</Label>
              <Select value={form.workTypeId ?? UNASSIGNED} onValueChange={(v) => (v === UNASSIGNED ? set("workTypeId", null) : onWorkTypeChange(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>No type</SelectItem>
                  {workTypes.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Client</Label>
              <Select
                value={form.organizationId ?? UNASSIGNED}
                onValueChange={(v) => onOrgChange(v === UNASSIGNED ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>No client</SelectItem>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Contact</Label>
              <Select
                value={form.contactId ?? UNASSIGNED}
                onValueChange={(v) => set("contactId", v === UNASSIGNED ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select contact" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>No contact</SelectItem>
                  {availableContacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Assignee</Label>
              <Select
                value={form.assigneeId ?? UNASSIGNED}
                onValueChange={(v) => set("assigneeId", v === UNASSIGNED ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={form.statusId ?? UNASSIGNED} onValueChange={(v) => set("statusId", v === UNASSIGNED ? null : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <Select value={form.priority ?? "normal"} onValueChange={(v) => set("priority", v as WorkPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as WorkPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="wd-budget">Budget (minutes)</Label>
              <Input
                id="wd-budget"
                type="number"
                min={0}
                placeholder="e.g. 120"
                value={form.budgetMinutes ?? ""}
                onChange={(e) => set("budgetMinutes", e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="wd-start">Start date</Label>
              <Input
                id="wd-start"
                type="date"
                value={form.startDate ?? ""}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="wd-due">Due date</Label>
              <Input
                id="wd-due"
                type="date"
                value={form.dueDate ?? ""}
                onChange={(e) => set("dueDate", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wd-desc">Description</Label>
            <Textarea
              id="wd-desc"
              placeholder="Scope, notes, instructions…"
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : item ? "Save changes" : "Create work"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
