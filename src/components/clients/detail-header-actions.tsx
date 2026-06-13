"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrgDialog } from "./org-dialog";
import { archiveOrganization } from "@/app/(app)/clients/actions";
import type { Organization } from "@/db/schema";

export function DetailHeaderActions({
  org,
  users,
  canEditEin = false,
}: {
  org: Organization;
  users: { id: string; name: string }[];
  canEditEin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  async function onArchive() {
    if (!confirm(`Archive ${org.name}? It will be hidden from the client list.`)) return;
    const res = await archiveOrganization(org.id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Client archived");
    router.push("/clients");
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" /> Edit
      </Button>
      <Button variant="ghost" size="sm" onClick={onArchive} className="text-muted-foreground">
        <Archive className="h-4 w-4" /> Archive
      </Button>
      <OrgDialog open={open} onOpenChange={setOpen} org={org} users={users} canEditEin={canEditEin} />
    </div>
  );
}
