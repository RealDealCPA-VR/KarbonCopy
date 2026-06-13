"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  ListChecks,
  Workflow,
  FolderCog,
  FileText,
  AlertTriangle,
  Plus,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { applyWorkflowPlan } from "@/app/(app)/automate/actions";

/* ------------------------------------------------------------------ */
/* Plan shape (mirrors src/lib/ai-workflow.ts — that module is         */
/* server-only, so we keep a structural type here for the client).     */
/* ------------------------------------------------------------------ */

type Plan = {
  summary?: string;
  warnings?: string[];
  workTemplate: {
    name: string;
    workTypeId?: string | null;
    recurrenceRule?: string | null;
    defaultBudgetMinutes?: number | null;
  };
  tasks: Array<{ title: string; section?: string | null; dueOffsetDays?: number | null }>;
  automators: Array<{
    name: string;
    trigger: string;
    action: string;
    conditions?: Record<string, unknown> | null;
    actionParams?: Record<string, unknown> | null;
  }>;
  fileRules: Array<{
    name: string;
    globPattern: string;
    event: string;
    notify?: string[] | string | null;
    message?: string | null;
    severity?: string | null;
  }>;
};

const EXAMPLES = [
  "Set up a monthly bookkeeping client with QuickBooks reconciliation",
  "Onboard a new 1040 individual tax return engagement",
  "Quarterly payroll filing workflow with client review",
  "Annual 1120S S-corp return with extension handling",
];

export function AutomateClient() {
  const router = useRouter();
  const [prompt, setPrompt] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [applied, setApplied] = React.useState<{ templateId: string } | null>(null);

  async function generate() {
    const trimmed = prompt.trim();
    if (!trimmed) return toast.error("Describe the engagement first.");
    setGenerating(true);
    setPlan(null);
    setApplied(null);
    try {
      const res = await fetch("/api/automate/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });
      const body = (await res.json()) as { plan?: Plan; error?: string };
      if (!res.ok || !body.plan) {
        toast.error(body.error ?? "Could not generate a plan.");
        return;
      }
      setPlan(body.plan);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setApplying(true);
    try {
      // The server action re-validates the plan against the live firm config;
      // cast the structural client Plan to its parameter type.
      const res = await applyWorkflowPlan(
        { ...plan, summary: plan.summary ?? "" } as Parameters<typeof applyWorkflowPlan>[0],
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setApplied({ templateId: res.data.templateId });
      toast.success(
        `Workflow applied: ${res.data.taskCount} tasks, ${res.data.automatorCount} automators, ${res.data.fileRuleCount} file rules.`,
      );
      router.refresh();
    } catch {
      toast.error("Failed to apply the workflow.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Prompt box */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Set up a monthly bookkeeping client"
            rows={3}
            className="resize-none text-base"
            disabled={generating}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                disabled={generating}
                className="rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Grounded in your firm&apos;s statuses, work types, and people.
            </p>
            <Button onClick={generate} disabled={generating || !prompt.trim()}>
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Generate
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {generating && <PlanSkeleton />}

      {plan && !generating && (
        <PlanPreview
          plan={plan}
          applying={applying}
          applied={applied}
          onApply={apply}
          onViewTemplate={() =>
            applied && router.push(`/work/templates`)
          }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

function PlanPreview({
  plan,
  applying,
  applied,
  onApply,
  onViewTemplate,
}: {
  plan: Plan;
  applying: boolean;
  applied: { templateId: string } | null;
  onApply: () => void;
  onViewTemplate: () => void;
}) {
  const tpl = plan.workTemplate;
  return (
    <div className="space-y-5">
      {plan.summary && (
        <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">{plan.summary}</p>
      )}

      {plan.warnings && plan.warnings.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" /> Adjustments made for your config
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Template */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4 text-primary" /> Work template
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-lg font-semibold">{tpl.name}</div>
          <div className="flex flex-wrap gap-2 text-sm">
            {tpl.recurrenceRule && <Badge variant="secondary">Recurs: {tpl.recurrenceRule}</Badge>}
            {tpl.defaultBudgetMinutes != null && (
              <Badge variant="secondary">Budget: {tpl.defaultBudgetMinutes} min</Badge>
            )}
            {tpl.workTypeId ? (
              <Badge variant="outline">Work type linked</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                No work type
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tasks */}
      <Section
        icon={<ListChecks className="h-4 w-4 text-primary" />}
        title="Tasks"
        count={plan.tasks.length}
      >
        {plan.tasks.length === 0 ? (
          <Empty>No tasks proposed.</Empty>
        ) : (
          <ol className="divide-y">
            {plan.tasks.map((t, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t.title}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {t.section && <span>{t.section}</span>}
                    {t.dueOffsetDays != null && (
                      <span>
                        due +{t.dueOffsetDays} day{t.dueOffsetDays === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* Automators */}
      <Section
        icon={<Workflow className="h-4 w-4 text-primary" />}
        title="Automators"
        count={plan.automators.length}
      >
        {plan.automators.length === 0 ? (
          <Empty>No automators proposed.</Empty>
        ) : (
          <div className="space-y-2.5">
            {plan.automators.map((a, i) => (
              <div key={i} className="rounded-lg border bg-muted/20 p-3">
                <div className="text-sm font-medium">{a.name}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="secondary" className="font-mono">
                    {a.trigger}
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <Badge variant="secondary" className="font-mono">
                    {a.action}
                  </Badge>
                </div>
                {(hasKeys(a.conditions) || hasKeys(a.actionParams)) && (
                  <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {hasKeys(a.conditions) && <KeyVals label="when" obj={a.conditions!} />}
                    {hasKeys(a.actionParams) && <KeyVals label="then" obj={a.actionParams!} />}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* File rules */}
      <Section
        icon={<FolderCog className="h-4 w-4 text-primary" />}
        title="File rules"
        count={plan.fileRules.length}
      >
        {plan.fileRules.length === 0 ? (
          <Empty>No file rules proposed.</Empty>
        ) : (
          <div className="space-y-2.5">
            {plan.fileRules.map((r, i) => (
              <div key={i} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{r.name}</div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      r.severity === "warning" && "bg-warning/15 text-warning",
                      r.severity === "success" && "bg-success/15 text-success",
                    )}
                  >
                    {r.severity ?? "success"}
                  </Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3" />
                  <code className="rounded bg-muted px-1 py-0.5">{r.globPattern}</code>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {r.event}
                  </Badge>
                </div>
                {r.message && (
                  <div className="mt-1.5 text-xs text-muted-foreground">{r.message}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Separator />

      {/* Apply footer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {applied ? (
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" /> Workflow applied.
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Review the plan above, then apply it to create the template and rules.
          </p>
        )}
        <div className="flex items-center gap-2">
          {applied ? (
            <Button onClick={onViewTemplate}>
              View templates <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={onApply} disabled={applying}>
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Applying…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> Apply workflow
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                               */
/* ------------------------------------------------------------------ */

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
          <Badge variant="outline" className="ml-1">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

function KeyVals({ label, obj }: { label: string; obj: Record<string, unknown> }) {
  return (
    <div>
      <span className="font-medium">{label}: </span>
      {Object.entries(obj).map(([k, v], i) => (
        <span key={k}>
          {i > 0 && ", "}
          <span className="font-mono">{k}</span>=
          <span className="font-mono">{String(v)}</span>
        </span>
      ))}
    </div>
  );
}

function hasKeys(obj: Record<string, unknown> | null | undefined): boolean {
  return !!obj && Object.keys(obj).length > 0;
}

function PlanSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-3 py-5">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
