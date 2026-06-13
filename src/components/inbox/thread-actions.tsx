"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Briefcase, CheckCircle2, Clock, CircleDot, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  setThreadStatus,
  convertThreadToWork,
} from "@/app/(app)/inbox/actions";
import { STATUS_ORDER, STATUS_META, type ThreadDetail } from "./types";
import type { UserLite, OrgLite, ContactLite, WorkLite } from "./types";

const STATUS_ICON = {
  open: CircleDot,
  assigned: UserCheck,
  waiting: Clock,
  closed: CheckCircle2,
} as const;

export function ThreadActions({
  thread,
}: {
  thread: ThreadDetail;
  users: UserLite[];
  organizations: OrgLite[];
  contacts: ContactLite[];
  workItems: WorkLite[];
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function changeStatus(status: ThreadDetail["status"]) {
    setPending(true);
    const res = await setThreadStatus(thread.id, status);
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Marked ${STATUS_META[status].label.toLowerCase()}`);
    router.refresh();
  }

  async function convert() {
    setPending(true);
    const res = await convertThreadToWork(thread.id);
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Work item created from thread");
    router.refresh();
    if ("data" in res && res.data?.workItemId) {
      router.push(`/work/${res.data.workItemId}`);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" disabled={pending}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Set status</DropdownMenuLabel>
        {STATUS_ORDER.map((s) => {
          const Icon = STATUS_ICON[s];
          return (
            <DropdownMenuItem
              key={s}
              onClick={() => changeStatus(s)}
              disabled={thread.status === s}
            >
              <Icon className="h-4 w-4" />
              {STATUS_META[s].label}
              {thread.status === s && (
                <span className="ml-auto text-xs text-muted-foreground">current</span>
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={convert} disabled={Boolean(thread.workItemId)}>
          <Briefcase className="h-4 w-4" />
          {thread.workItemId ? "Work item linked" : "Convert to work item"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
