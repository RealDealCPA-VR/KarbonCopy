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
import { ENTITY_TYPES } from "./entity-types";
import { createOrganization, updateOrganization } from "@/app/(app)/clients/actions";
import type { EntityType, Organization } from "@/db/schema";

type UserLite = { id: string; name: string };

export function OrgDialog({
  open,
  onOpenChange,
  org,
  users,
  canEditEin = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  org?: Organization | null;
  users: UserLite[];
  /**
   * Whether the current user may view/edit the cleartext EIN. When false the
   * field is hidden and the EIN is left untouched on save (server preserves it).
   */
  canEditEin?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [entityType, setEntityType] = React.useState<EntityType>(org?.entityType ?? "c_corp");
  const [ownerId, setOwnerId] = React.useState<string>(org?.ownerId ?? "none");
  const editing = Boolean(org?.id);

  // Reset local select state whenever the dialog opens for a different org.
  React.useEffect(() => {
    if (open) {
      setEntityType(org?.entityType ?? "c_corp");
      setOwnerId(org?.ownerId ?? "none");
    }
  }, [open, org]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("entityType", entityType);
    form.set("ownerId", ownerId === "none" ? "" : ownerId);
    if (editing && org) form.set("id", org.id);
    // Signal whether the EIN field was present so the server can preserve the
    // stored value for users who aren't allowed to edit it.
    form.set("einEditable", canEditEin ? "1" : "0");

    setPending(true);
    const res = editing ? await updateOrganization(form) : await createOrganization(form);
    setPending(false);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(editing ? "Client updated" : "Client created");
    onOpenChange(false);
    if (!editing && "data" in res && res.data?.id) {
      router.push(`/clients/${res.data.id}`);
    } else {
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit client" : "New client"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this organization's details."
              : "Add an organization to your client roster."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" name="name" defaultValue={org?.name ?? ""} required autoFocus />
            </div>

            <div className="space-y-1.5">
              <Label>Entity type</Label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Relationship manager</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
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

            {canEditEin ? (
              <div className="space-y-1.5">
                <Label htmlFor="ein">EIN</Label>
                <Input id="ein" name="ein" defaultValue={org?.ein ?? ""} placeholder="12-3456789" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>EIN</Label>
                <div className="flex h-9 items-center text-sm italic text-muted-foreground">
                  Hidden — requires manager access
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="fiscalYearEnd">Fiscal year end</Label>
              <Input
                id="fiscalYearEnd"
                name="fiscalYearEnd"
                defaultValue={org?.fiscalYearEnd ?? ""}
                placeholder="MM-DD (e.g. 12-31)"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue={org?.email ?? ""} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={org?.phone ?? ""} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" defaultValue={org?.website ?? ""} placeholder="https://" />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" name="address" defaultValue={org?.address ?? ""} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={org?.notes ?? ""} rows={3} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save changes" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
