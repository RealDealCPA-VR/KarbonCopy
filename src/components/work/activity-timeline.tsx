import { formatDistanceToNow } from "date-fns";
import {
  Plus,
  Pencil,
  CheckCircle2,
  ArrowRight,
  UserPlus,
  MessageSquare,
  Zap,
  Trash2,
  Activity as ActivityIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Activity } from "@/db/schema";

const VERB_ICON: Record<string, { icon: typeof Plus; tone: string }> = {
  created: { icon: Plus, tone: "text-primary bg-primary/10" },
  updated: { icon: Pencil, tone: "text-muted-foreground bg-muted" },
  completed: { icon: CheckCircle2, tone: "text-success bg-success/10" },
  moved: { icon: ArrowRight, tone: "text-muted-foreground bg-muted" },
  assigned: { icon: UserPlus, tone: "text-primary bg-primary/10" },
  commented: { icon: MessageSquare, tone: "text-muted-foreground bg-muted" },
  automated: { icon: Zap, tone: "text-warning bg-warning/10" },
  deleted: { icon: Trash2, tone: "text-destructive bg-destructive/10" },
};

export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
        <ActivityIcon className="mb-2 h-6 w-6 opacity-50" />
        No activity recorded yet.
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 pl-2">
      {activities.map((a, i) => {
        const meta = VERB_ICON[a.verb] ?? { icon: ActivityIcon, tone: "text-muted-foreground bg-muted" };
        const Icon = meta.icon;
        const last = i === activities.length - 1;
        return (
          <li key={a.id} className="relative flex gap-3">
            {!last && <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-border" />}
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.tone)}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm">{a.summary}</p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
