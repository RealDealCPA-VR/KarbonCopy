"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, ChevronUp, ChevronDown, ListChecks } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  addTask,
  toggleTask,
  deleteTask,
  reorderTask,
  markWorkComplete,
} from "@/app/(app)/work/actions";
import type { WorkTask } from "./types";

export function TaskChecklist({
  workItemId,
  tasks,
  isComplete,
}: {
  workItemId: string;
  tasks: WorkTask[];
  isComplete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [optimistic, setOptimistic] = React.useState(tasks);
  const [newTitle, setNewTitle] = React.useState("");
  const [newSection, setNewSection] = React.useState("");
  const [suggested, setSuggested] = React.useState(false);

  React.useEffect(() => setOptimistic(tasks), [tasks]);

  const total = optimistic.length;
  const done = optimistic.filter((t) => t.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  // Group by section, preserving first-seen order.
  const sections = React.useMemo(() => {
    const map = new Map<string, WorkTask[]>();
    const sorted = [...optimistic].sort(
      (a, b) => a.position - b.position || +new Date(a.createdAt) - +new Date(b.createdAt),
    );
    for (const t of sorted) {
      const key = t.section || "";
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [optimistic]);

  function onToggle(task: WorkTask, checked: boolean) {
    setOptimistic((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, completed: checked } : t)),
    );
    startTransition(async () => {
      try {
        await toggleTask(task.id, checked);
        // Suggest marking work complete when everything is checked.
        const after = optimistic.map((t) => (t.id === task.id ? { ...t, completed: checked } : t));
        if (after.length > 0 && after.every((t) => t.completed) && !isComplete) {
          setSuggested(true);
        } else {
          setSuggested(false);
        }
        router.refresh();
      } catch {
        toast.error("Couldn't update task");
        setOptimistic(tasks);
      }
    });
  }

  function onAdd() {
    const title = newTitle.trim();
    if (!title) return;
    startTransition(async () => {
      try {
        await addTask({ workItemId, title, section: newSection.trim() || null });
        setNewTitle("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't add task");
      }
    });
  }

  function onDelete(id: string) {
    setOptimistic((prev) => prev.filter((t) => t.id !== id));
    startTransition(async () => {
      try {
        await deleteTask(id);
        router.refresh();
      } catch {
        toast.error("Couldn't delete task");
        setOptimistic(tasks);
      }
    });
  }

  function onReorder(id: string, dir: "up" | "down") {
    startTransition(async () => {
      await reorderTask(id, dir);
      router.refresh();
    });
  }

  function completeWork() {
    startTransition(async () => {
      try {
        await markWorkComplete(workItemId);
        toast.success("Work marked complete");
        setSuggested(false);
        router.refresh();
      } catch {
        toast.error("Couldn't complete work");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Progress value={pct} className="h-2" indicatorClassName={pct === 100 ? "bg-success" : undefined} />
        <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
      </div>

      {suggested && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm">
          <span>All tasks are done. Mark this work complete?</span>
          <Button size="sm" variant="success" onClick={completeWork} disabled={pending}>
            Mark complete
          </Button>
        </div>
      )}

      {total === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          <ListChecks className="mb-2 h-6 w-6 opacity-50" />
          No tasks yet. Add a checklist below.
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map(([section, sectionTasks]) => (
            <div key={section || "_"}>
              {section && (
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section}
                </div>
              )}
              <div className="space-y-0.5">
                {sectionTasks.map((task, idx) => (
                  <div
                    key={task.id}
                    className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
                  >
                    <Checkbox
                      checked={task.completed}
                      onCheckedChange={(v) => onToggle(task, v === true)}
                    />
                    <span
                      className={cn(
                        "flex-1 text-sm",
                        task.completed && "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </span>
                    <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => onReorder(task.id, "up")}
                        disabled={idx === 0}
                        className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                        title="Move up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onReorder(task.id, "down")}
                        disabled={idx === sectionTasks.length - 1}
                        className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                        title="Move down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(task.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Add a task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
          className="flex-1"
        />
        <Input
          placeholder="Section (optional)"
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
          className="sm:w-40"
        />
        <Button onClick={onAdd} disabled={pending || !newTitle.trim()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
    </div>
  );
}
