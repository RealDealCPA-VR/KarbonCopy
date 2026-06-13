"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createThread } from "@/app/(app)/inbox/actions";
import type { OrgLite } from "./types";

export function NewThreadDialog({
  open,
  onOpenChange,
  organizations,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizations: OrgLite[];
  onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [organizationId, setOrganizationId] = React.useState("none");

  React.useEffect(() => {
    if (open) setOrganizationId("none");
  }, [open]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("organizationId", organizationId === "none" ? "" : organizationId);

    setPending(true);
    const res = await createThread(form);
    setPending(false);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Thread created");
    onOpenChange(false);
    if ("data" in res && res.data?.id) {
      onCreated?.(res.data.id);
      router.refresh();
    } else {
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New thread</DialogTitle>
          <DialogDescription>
            Log an incoming message to triage it through the shared inbox.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject *</Label>
            <Input id="subject" name="subject" required autoFocus placeholder="Question about Q3 estimates" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fromName">From name</Label>
              <Input id="fromName" name="fromName" placeholder="Jane Client" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fromEmail">From email</Label>
              <Input id="fromEmail" name="fromEmail" type="email" placeholder="jane@acme.com" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Link client (optional)</Label>
            <Select value={organizationId} onValueChange={setOrganizationId}>
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Message *</Label>
            <Textarea
              id="body"
              name="body"
              required
              rows={5}
              placeholder="Paste the email or describe what came in…"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create thread"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
