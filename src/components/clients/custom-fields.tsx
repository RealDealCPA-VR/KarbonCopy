"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setCustomFieldValue } from "@/app/(app)/clients/actions";

export type CustomFieldDef = {
  id: string;
  label: string;
  fieldType: "text" | "number" | "date" | "select" | "boolean";
  options: string[] | null;
  value: string | null;
};

export function CustomFields({
  entityId,
  fields,
}: {
  entityId: string;
  fields: CustomFieldDef[];
}) {
  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No custom fields configured for organizations.
      </p>
    );
  }
  return (
    <dl className="divide-y">
      {fields.map((f) => (
        <CustomFieldRow key={f.id} entityId={entityId} field={f} />
      ))}
    </dl>
  );
}

function CustomFieldRow({ entityId, field }: { entityId: string; field: CustomFieldDef }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(field.value ?? "");
  const [pending, setPending] = React.useState(false);

  async function save(next: string | null) {
    setPending(true);
    const res = await setCustomFieldValue(field.id, entityId, next);
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  // Boolean fields toggle inline without an edit mode.
  if (field.fieldType === "boolean") {
    const on = value === "true";
    return (
      <div className="flex items-center justify-between py-3">
        <dt className="text-sm font-medium">{field.label}</dt>
        <dd>
          <Switch
            checked={on}
            disabled={pending}
            onCheckedChange={(v) => {
              setValue(v ? "true" : "false");
              void save(v ? "true" : "false");
            }}
          />
        </dd>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="shrink-0 text-sm font-medium">{field.label}</dt>
      <dd className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {editing ? (
          <>
            {field.fieldType === "select" ? (
              <Select value={value || "__none"} onValueChange={(v) => setValue(v === "__none" ? "" : v)}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {(field.options ?? []).map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"}
                className="h-8 w-44"
                autoFocus
              />
            )}
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={pending} onClick={() => save(value || null)}>
              <Check className="h-4 w-4 text-success" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setValue(field.value ?? "");
                setEditing(false);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className={value ? "text-foreground" : "italic"}>{value || "Set value"}</span>
            <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
      </dd>
    </div>
  );
}
