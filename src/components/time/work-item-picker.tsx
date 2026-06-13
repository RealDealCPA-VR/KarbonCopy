"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { WorkItemOption } from "./types";

/** Searchable work-item combobox grouped by client. */
export function WorkItemPicker({
  workItems,
  value,
  onChange,
  placeholder = "Select work item…",
  className,
}: {
  workItems: WorkItemOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = workItems.find((w) => w.id === value) ?? null;

  // Group items by client name for nicer browsing.
  const groups = React.useMemo(() => {
    const m = new Map<string, WorkItemOption[]>();
    for (const w of workItems) {
      const key = w.clientName ?? "No client";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(w);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [workItems]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Briefcase className="h-4 w-4 shrink-0 opacity-60" />
            <span className="truncate">
              {selected ? selected.title : placeholder}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search work items…" />
          <CommandList>
            <CommandEmpty>No work items found.</CommandEmpty>
            {groups.map(([client, items]) => (
              <CommandGroup key={client} heading={client}>
                {items.map((w) => (
                  <CommandItem
                    key={w.id}
                    value={`${w.title} ${client}`}
                    onSelect={() => {
                      onChange(w.id === value ? null : w.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("h-4 w-4", w.id === value ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{w.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
