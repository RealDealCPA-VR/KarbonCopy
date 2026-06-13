"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Send,
  StickyNote,
  Sparkles,
  ListChecks,
  FileText,
  Loader2,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { addMessage, addTasksToThreadWork } from "@/app/(app)/inbox/actions";

type Mode = "reply" | "note";

export function Composer({
  threadId,
  hasLinkedWork,
  aiEnabled,
}: {
  threadId: string;
  hasLinkedWork: boolean;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("reply");
  const [body, setBody] = React.useState("");
  const [pending, setPending] = React.useState(false);

  // AI state
  const [instruction, setInstruction] = React.useState("");
  const [busy, setBusy] = React.useState<null | "draft" | "summary" | "tasks">(null);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [tasks, setTasks] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    setBody("");
    setSummary(null);
    setTasks(null);
    setInstruction("");
    setMode("reply");
  }, [threadId]);

  async function submit() {
    if (!body.trim()) {
      toast.error("Message cannot be empty.");
      return;
    }
    const form = new FormData();
    form.set("threadId", threadId);
    form.set("body", body);
    form.set("direction", mode === "note" ? "note" : "outbound");
    setPending(true);
    const res = await addMessage(form);
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setBody("");
    toast.success(mode === "note" ? "Note added" : "Reply sent");
    router.refresh();
  }

  async function callAi(kind: "draft" | "summary" | "tasks") {
    setBusy(kind);
    try {
      const route =
        kind === "draft" ? "draft" : kind === "summary" ? "summarize" : "extract";
      const res = await fetch(`/api/inbox/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "AI request failed.");
        return;
      }
      if (kind === "draft") {
        setMode("reply");
        setBody(data.draft ?? "");
        toast.success("Draft ready — review before sending");
      } else if (kind === "summary") {
        setSummary(data.summary ?? "");
      } else {
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      }
    } catch {
      toast.error("AI request failed.");
    } finally {
      setBusy(null);
    }
  }

  async function addExtractedTasks() {
    if (!tasks?.length) return;
    const res = await addTasksToThreadWork(threadId, tasks);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Added ${res.data?.count ?? tasks.length} task(s) to the linked work item`);
    setTasks(null);
    router.refresh();
  }

  return (
    <div className="space-y-3 border-t bg-muted/30 p-4">
      {/* AI results */}
      {summary && (
        <div className="rounded-xl border bg-background p-3 text-sm">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Summary
            <button
              type="button"
              onClick={() => setSummary(null)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
          <p className="whitespace-pre-wrap text-muted-foreground">{summary}</p>
        </div>
      )}

      {tasks && (
        <div className="rounded-xl border bg-background p-3 text-sm">
          <div className="mb-2 flex items-center gap-1.5 font-medium">
            <ListChecks className="h-3.5 w-3.5 text-primary" /> Extracted tasks
            <button
              type="button"
              onClick={() => setTasks(null)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
          {tasks.length === 0 ? (
            <p className="text-muted-foreground">No actionable tasks found.</p>
          ) : (
            <>
              <ul className="space-y-1">
                {tasks.map((t, i) => (
                  <li key={i} className="flex items-start gap-2 text-muted-foreground">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                    {t}
                  </li>
                ))}
              </ul>
              <div className="mt-2">
                {hasLinkedWork ? (
                  <Button size="sm" variant="secondary" onClick={addExtractedTasks}>
                    <Plus className="h-4 w-4" /> Add to linked work item
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Link a work item to add these as checklist tasks.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Mode toggle + AI buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border bg-background p-0.5">
          <Button
            variant={mode === "reply" ? "secondary" : "ghost"}
            size="sm"
            className="h-7"
            onClick={() => setMode("reply")}
          >
            <Send className="h-3.5 w-3.5" /> Reply
          </Button>
          <Button
            variant={mode === "note" ? "secondary" : "ghost"}
            size="sm"
            className="h-7"
            onClick={() => setMode("note")}
          >
            <StickyNote className="h-3.5 w-3.5" /> Note
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <AiButton
            enabled={aiEnabled}
            busy={busy === "summary"}
            onClick={() => callAi("summary")}
            icon={FileText}
            label="Summarize"
          />
          <AiButton
            enabled={aiEnabled}
            busy={busy === "tasks"}
            onClick={() => callAi("tasks")}
            icon={ListChecks}
            label="Extract tasks"
          />
          <DraftButton
            enabled={aiEnabled}
            busy={busy === "draft"}
            instruction={instruction}
            setInstruction={setInstruction}
            onDraft={() => callAi("draft")}
          />
        </div>
      </div>

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder={
          mode === "note"
            ? "Internal note (only your team sees this)…"
            : "Write a reply to the client…"
        }
        className={cn(mode === "note" && "bg-warning/5 focus-visible:ring-warning")}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {mode === "note" ? "Visible to your team only" : "Sends as an outbound reply"} · ⌘/Ctrl+Enter
        </span>
        <Button onClick={submit} disabled={pending || !body.trim()}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "note" ? (
            <StickyNote className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {mode === "note" ? "Add note" : "Send reply"}
        </Button>
      </div>
    </div>
  );
}

function AiButton({
  enabled,
  busy,
  onClick,
  icon: Icon,
  label,
}: {
  enabled: boolean;
  busy: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const btn = (
    <Button
      variant="outline"
      size="sm"
      className="h-7"
      onClick={onClick}
      disabled={!enabled || busy}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
  if (enabled) return btn;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{btn}</span>
        </TooltipTrigger>
        <TooltipContent>Set ANTHROPIC_API_KEY to enable AI</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DraftButton({
  enabled,
  busy,
  instruction,
  setInstruction,
  onDraft,
}: {
  enabled: boolean;
  busy: boolean;
  instruction: string;
  setInstruction: (v: string) => void;
  onDraft: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  if (!enabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button variant="outline" size="sm" className="h-7" disabled>
                <Sparkles className="h-3.5 w-3.5" /> Draft reply
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Set ANTHROPIC_API_KEY to enable AI</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7" disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Draft reply
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ai-instruction" className="text-xs">
            Instruction (optional)
          </Label>
          <Input
            id="ai-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. politely ask for the missing W-2"
          />
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            onDraft();
          }}
        >
          <Sparkles className="h-4 w-4" /> Generate draft
        </Button>
        <p className="text-xs text-muted-foreground">
          The draft lands in the reply box for you to review and edit.
        </p>
      </PopoverContent>
    </Popover>
  );
}
