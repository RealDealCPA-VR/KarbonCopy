"use client";
import * as React from "react";
import { Bell, BellRing, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { cn } from "@/lib/utils";

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string | number;
};

export function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = React.useState<Notif[]>([]);
  const unread = items.filter((n) => !n.read).length;

  const load = React.useCallback(async () => {
    const r = await fetch("/api/notifications");
    if (r.ok) setItems((await r.json()).notifications);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  useRealtimeEvent<Notif>("notification", (n) => setItems((prev) => [n, ...prev]));

  const markAll = async () => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          {unread > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={markAll}>
              <Check className="h-3 w-3" /> Mark all read
            </Button>
          )}
        </div>
        <Separator />
        <div className="max-h-80 overflow-auto">
          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up 🎉</p>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                className={cn("border-b px-3 py-2.5 text-sm last:border-0", !n.read && "bg-accent/40")}
              >
                <div className="flex items-center gap-2">
                  {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                  <span className="font-medium">{n.title}</span>
                </div>
                {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </p>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
