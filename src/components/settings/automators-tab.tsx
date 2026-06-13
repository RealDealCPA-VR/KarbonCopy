"use client";

import * as React from "react";
import { Zap, Plus, Trash2, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Automator, AutomatorAction, AutomatorTrigger } from "@/db/schema";
import {
  createAutomator,
  deleteAutomator,
  updateAutomator,
} from "@/app/(app)/settings/actions";

// `available: false` = the rule engine does not implement this yet. These are shown
// but disabled in the create dialog so admins can't create dead rules.
const TRIGGERS: { value: AutomatorTrigger; label: string; available: boolean }[] = [
  { value: "status_changed", label: "Status changed", available: true },
  { value: "work_created", label: "Work created", available: false },
  { value: "task_completed", label: "Task completed", available: false },
  { value: "due_approaching", label: "Due date approaching", available: false },
  { value: "file_event", label: "File-server event", available: false },
  { value: "all_tasks_done", label: "All tasks done", available: false },
];

const ACTIONS: { value: AutomatorAction; label: string; available: boolean }[] = [
  { value: "set_status", label: "Set status", available: true },
  { value: "assign", label: "Assign", available: true },
  { value: "notify", label: "Notify", available: true },
  { value: "create_task", label: "Create task", available: false },
  { value: "send_email", label: "Send email", available: false },
  { value: "create_work", label: "Create work item", available: false },
];

const triggerLabel = (t: AutomatorTrigger) => TRIGGERS.find((x) => x.value === t)?.label ?? t;
const actionLabel = (a: AutomatorAction) => ACTIONS.find((x) => x.value === a)?.label ?? a;

export function AutomatorsTab({ automators: initial }: { automators: Automator[] }) {
  const [automators, setAutomators] = React.useState(initial);

  const toggle = async (a: Automator, enabled: boolean) => {
    setAutomators((prev) => prev.map((x) => (x.id === a.id ? { ...x, enabled } : x)));
    const res = await updateAutomator(a.id, { enabled });
    if (!res.ok) {
      setAutomators((prev) => prev.map((x) => (x.id === a.id ? { ...x, enabled: !enabled } : x)));
      toast.error(res.error);
    }
  };

  const remove = async (a: Automator) => {
    if (!confirm(`Delete automator “${a.name}”?`)) return;
    const prev = automators;
    setAutomators((p) => p.filter((x) => x.id !== a.id));
    const res = await deleteAutomator(a.id);
    if (!res.ok) {
      setAutomators(prev);
      toast.error(res.error);
      return;
    }
    toast.success("Automator deleted");
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> Automators
          </CardTitle>
          <CardDescription>When something happens, automatically do something else.</CardDescription>
        </div>
        <CreateAutomatorDialog onCreated={(a) => setAutomators((prev) => [...prev, a])} />
      </CardHeader>
      <CardContent className="space-y-3">
        {automators.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Zap className="h-6 w-6" />
            </div>
            <p className="font-medium">No automators yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Automate routine steps, e.g. notify the manager when all tasks on a return are done.
            </p>
          </div>
        ) : (
          automators.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm"
            >
              <div
                className={
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg " +
                  (a.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")
                }
              >
                <Zap className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{a.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="secondary" className="font-normal">
                    {triggerLabel(a.trigger)}
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <Badge variant="outline" className="font-normal">
                    {actionLabel(a.action)}
                  </Badge>
                  {a.runCount > 0 && (
                    <span className="text-muted-foreground">· ran {a.runCount}×</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch checked={a.enabled} onCheckedChange={(v) => toggle(a, v)} />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(a)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function CreateAutomatorDialog({ onCreated }: { onCreated: (a: Automator) => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [trigger, setTrigger] = React.useState<AutomatorTrigger>("status_changed");
  const [action, setAction] = React.useState<AutomatorAction>("notify");
  const [enabled, setEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const reset = () => {
    setName("");
    setTrigger("status_changed");
    setAction("notify");
    setEnabled(true);
  };

  const submit = async () => {
    setSaving(true);
    const res = await createAutomator({ name, trigger, action, enabled });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onCreated({
      id: "data" in res && res.data ? res.data.id : Math.random().toString(),
      name: name.trim(),
      trigger,
      action,
      enabled,
      conditions: {},
      actionParams: {},
      runCount: 0,
      lastRunAt: null,
      createdAt: new Date(),
    });
    toast.success("Automator created");
    reset();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> New automator
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New automator</DialogTitle>
          <DialogDescription>Pick a trigger and the action it should perform.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="a-name">Name</Label>
            <Input
              id="a-name"
              placeholder="Notify manager on completion"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>When (trigger)</Label>
              <Select value={trigger} onValueChange={(v) => setTrigger(v as AutomatorTrigger)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => (
                    <SelectItem key={t.value} value={t.value} disabled={!t.available}>
                      {t.label}
                      {!t.available && " (coming soon)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Then (action)</Label>
              <Select value={action} onValueChange={(v) => setAction(v as AutomatorAction)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value} disabled={!a.available}>
                      {a.label}
                      {!a.available && " (coming soon)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Enabled</Label>
              <p className="text-xs text-muted-foreground">Run this automator immediately.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
