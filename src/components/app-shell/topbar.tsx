"use client";
import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, LogOut, Search, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/utils";
import { useRealtime } from "@/lib/realtime-client";
import { logoutAction } from "@/app/actions/session";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { CommandPalette } from "@/components/app-shell/command-palette";

type SafeUser = { id: string; name: string; email: string; role: string; image?: string };

export function Topbar({ user }: { user: SafeUser }) {
  const { theme, setTheme } = useTheme();
  const { online } = useRealtime();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
      <button
        onClick={() => setPaletteOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent"
      >
        <Search className="h-4 w-4" />
        <span>Search clients, work, files…</span>
        <kbd className="ml-auto rounded border bg-muted px-1.5 text-[10px] font-medium">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Badge variant="outline" className="gap-1.5 font-normal">
          <Wifi className="h-3 w-3 text-success" />
          {online.size} online
        </Badge>
        <NotificationBell userId={user.id} />
        <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <Sun className="h-4 w-4 dark:hidden" />
          <Moon className="hidden h-4 w-4 dark:block" />
        </Button>
        <div className="ml-1 flex items-center gap-2 pl-2">
          <Avatar className="h-8 w-8">
            {user.image && <AvatarImage src={user.image} />}
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="hidden leading-tight sm:block">
            <div className="text-sm font-medium">{user.name}</div>
            <div className="text-xs capitalize text-muted-foreground">{user.role}</div>
          </div>
          <form action={logoutAction}>
            <Button variant="ghost" size="icon" type="submit" title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
