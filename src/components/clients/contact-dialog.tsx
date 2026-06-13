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
import { Switch } from "@/components/ui/switch";
import { upsertContact } from "@/app/(app)/clients/actions";
import type { Contact } from "@/db/schema";

export function ContactDialog({
  open,
  onOpenChange,
  organizationId,
  contact,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string;
  contact?: Contact | null;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [isPrimary, setIsPrimary] = React.useState(contact?.isPrimary ?? false);
  const [portalEnabled, setPortalEnabled] = React.useState(contact?.portalEnabled ?? false);
  const editing = Boolean(contact?.id);

  React.useEffect(() => {
    if (open) {
      setIsPrimary(contact?.isPrimary ?? false);
      setPortalEnabled(contact?.portalEnabled ?? false);
    }
  }, [open, contact]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("organizationId", organizationId);
    form.set("isPrimary", isPrimary ? "true" : "false");
    form.set("portalEnabled", portalEnabled ? "true" : "false");
    if (editing && contact) form.set("id", contact.id);

    setPending(true);
    const res = await upsertContact(form);
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(editing ? "Contact updated" : "Contact added");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>People associated with this client.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name *</Label>
              <Input id="firstName" name="firstName" defaultValue={contact?.firstName ?? ""} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name *</Label>
              <Input id="lastName" name="lastName" defaultValue={contact?.lastName ?? ""} required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" defaultValue={contact?.title ?? ""} placeholder="Controller, Owner…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue={contact?.email ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={contact?.phone ?? ""} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={contact?.notes ?? ""} rows={2} />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Primary contact</Label>
                <p className="text-xs text-muted-foreground">The main point of contact for this client.</p>
              </div>
              <Switch checked={isPrimary} onCheckedChange={setIsPrimary} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Portal access</Label>
                <p className="text-xs text-muted-foreground">Allow this contact to use the client portal.</p>
              </div>
              <Switch checked={portalEnabled} onCheckedChange={setPortalEnabled} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
