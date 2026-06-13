"use client";

import * as React from "react";
import { Building, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSetting } from "@/app/(app)/settings/actions";

export function FirmTab({
  firmName: initialName,
  supportEmail: initialEmail,
}: {
  firmName: string;
  supportEmail: string;
}) {
  const [firmName, setFirmName] = React.useState(initialName);
  const [supportEmail, setSupportEmail] = React.useState(initialEmail);
  const [saving, setSaving] = React.useState(false);

  const dirty = firmName !== initialName || supportEmail !== initialEmail;

  const save = async () => {
    setSaving(true);
    const [a, b] = await Promise.all([
      saveSetting("firmName", firmName.trim()),
      saveSetting("supportEmail", supportEmail.trim()),
    ]);
    setSaving(false);
    if (a.ok && b.ok) toast.success("Firm settings saved");
    else toast.error((!a.ok && a.error) || (!b.ok && b.error) || "Failed to save");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building className="h-4 w-4" /> Firm settings
        </CardTitle>
        <CardDescription>Basic information about your practice.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firm-name">Firm name</Label>
            <Input
              id="firm-name"
              placeholder="Acme CPA Group"
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="firm-email">Support email</Label>
            <Input
              id="firm-email"
              type="email"
              placeholder="help@acmecpa.com"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
