"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, User, Briefcase, ArrowUpRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/clients/user-avatar";
import { assignThread, linkThread } from "@/app/(app)/inbox/actions";
import type { ThreadDetail, UserLite, OrgLite, ContactLite, WorkLite } from "./types";

export function ContextPanel({
  thread,
  users,
  organizations,
  contacts,
  workItems,
}: {
  thread: ThreadDetail;
  users: UserLite[];
  organizations: OrgLite[];
  contacts: ContactLite[];
  workItems: WorkLite[];
}) {
  const router = useRouter();

  // Scope contacts/work to the linked org when one exists.
  const scopedContacts = React.useMemo(
    () =>
      thread.organizationId
        ? contacts.filter((c) => c.organizationId === thread.organizationId)
        : contacts,
    [contacts, thread.organizationId],
  );
  const scopedWork = React.useMemo(
    () =>
      thread.organizationId
        ? workItems.filter((w) => w.organizationId === thread.organizationId || w.id === thread.workItemId)
        : workItems,
    [workItems, thread.organizationId, thread.workItemId],
  );

  async function onAssign(value: string) {
    const res = await assignThread(thread.id, value === "none" ? null : value);
    if (!res.ok) return toast.error(res.error);
    toast.success("Assignee updated");
    router.refresh();
  }

  async function onLink(
    key: "organizationId" | "contactId" | "workItemId",
    value: string,
  ) {
    const res = await linkThread(thread.id, { [key]: value === "none" ? null : value });
    if (!res.ok) return toast.error(res.error);
    toast.success("Link updated");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Details
      </h3>

      {/* Assignee */}
      <div className="space-y-1.5">
        <Label className="text-xs">Assigned to</Label>
        <Select value={thread.assigneeId ?? "none"} onValueChange={onAssign}>
          <SelectTrigger>
            <SelectValue placeholder="Unassigned">
              {thread.assignee ? (
                <span className="flex items-center gap-2">
                  <UserAvatar user={thread.assignee} className="h-5 w-5" />
                  {thread.assignee.name}
                </span>
              ) : (
                "Unassigned"
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator className="my-4" />

      {/* Client */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-xs">
          <Building2 className="h-3.5 w-3.5" /> Client
        </Label>
        <Select
          value={thread.organizationId ?? "none"}
          onValueChange={(v) => onLink("organizationId", v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="No client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No client</SelectItem>
            {organizations.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {thread.organizationId && (
          <Link
            href={`/clients/${thread.organizationId}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open client <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {/* Contact */}
      <div className="mt-4 space-y-1.5">
        <Label className="flex items-center gap-1.5 text-xs">
          <User className="h-3.5 w-3.5" /> Contact
        </Label>
        <Select
          value={thread.contactId ?? "none"}
          onValueChange={(v) => onLink("contactId", v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="No contact" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No contact</SelectItem>
            {scopedContacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator className="my-4" />

      {/* Work item */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-xs">
          <Briefcase className="h-3.5 w-3.5" /> Work item
        </Label>
        <Select
          value={thread.workItemId ?? "none"}
          onValueChange={(v) => onLink("workItemId", v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Not linked" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not linked</SelectItem>
            {scopedWork.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {thread.workItemId && (
          <Link
            href={`/work/${thread.workItemId}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open work item <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
        {!thread.workItemId && (
          <p className="text-xs text-muted-foreground">
            Use the ⋯ menu to convert this thread into a new work item.
          </p>
        )}
      </div>
    </div>
  );
}
