"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Phone, Plus, Star, Pencil, Trash2, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "./user-avatar";
import { ContactDialog } from "./contact-dialog";
import { toggleContactPortal, deleteContact } from "@/app/(app)/clients/actions";
import type { Contact } from "@/db/schema";

export function ContactsTab({
  organizationId,
  contacts,
}: {
  organizationId: string;
  contacts: Contact[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Contact | null>(null);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(c: Contact) {
    setEditing(c);
    setDialogOpen(true);
  }

  async function onTogglePortal(c: Contact, enabled: boolean) {
    const res = await toggleContactPortal(c.id, enabled);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (enabled && res.data?.inviteUrl) {
      try {
        await navigator.clipboard.writeText(res.data.inviteUrl);
      } catch {
        /* clipboard may be blocked; the link is still shown below */
      }
      toast.success("Portal invite created — link copied to clipboard", {
        description: res.data.inviteUrl,
      });
    } else {
      toast.success(enabled ? "Portal access enabled" : "Portal access disabled");
    }
    router.refresh();
  }

  async function onDelete(c: Contact) {
    if (!confirm(`Remove ${c.firstName} ${c.lastName}?`)) return;
    const res = await deleteContact(c.id);
    if (!res.ok) toast.error(res.error);
    else {
      toast.success("Contact removed");
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
        </h2>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4" /> Add contact
        </Button>
      </div>

      {contacts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UserPlus className="h-6 w-6" />
            </div>
            <p className="text-sm text-muted-foreground">No contacts yet for this client.</p>
            <Button size="sm" variant="outline" onClick={openNew}>
              <Plus className="h-4 w-4" /> Add the first contact
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {contacts.map((c) => (
            <Card key={c.id} className="group transition-shadow hover:shadow-md">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <UserAvatar
                    user={{ id: c.id, name: `${c.firstName} ${c.lastName}` }}
                    className="h-10 w-10"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">
                        {c.firstName} {c.lastName}
                      </span>
                      {c.isPrimary && (
                        <Badge variant="warning" className="gap-1">
                          <Star className="h-3 w-3" /> Primary
                        </Badge>
                      )}
                    </div>
                    {c.title && <div className="truncate text-sm text-muted-foreground">{c.title}</div>}
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => onDelete(c)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5 text-sm">
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className="flex items-center gap-2 text-muted-foreground hover:text-primary"
                    >
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </a>
                  )}
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="flex items-center gap-2 text-muted-foreground hover:text-primary"
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{c.phone}</span>
                    </a>
                  )}
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-xs text-muted-foreground">Portal access</span>
                  <Switch
                    checked={c.portalEnabled}
                    onCheckedChange={(v) => onTogglePortal(c, v)}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ContactDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizationId={organizationId}
        contact={editing}
      />
    </div>
  );
}
