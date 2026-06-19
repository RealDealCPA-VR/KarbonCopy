"use client";
import * as React from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import type { FileEventPayload } from "@/components/alerts/types";

type RealtimeCtx = {
  socket: Socket | null;
  online: Set<string>;
};
const Ctx = React.createContext<RealtimeCtx>({ socket: null, online: new Set() });

export function useRealtime() {
  return React.useContext(Ctx);
}

/** Subscribe to a realtime event for the lifetime of the component. */
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const { socket } = useRealtime();
  const ref = React.useRef(handler);
  ref.current = handler;
  React.useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => void socket.off(event, fn);
  }, [socket, event]);
}

export function RealtimeProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId?: string;
}) {
  const [socket, setSocket] = React.useState<Socket | null>(null);
  const [online, setOnline] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    // The server authenticates the socket from the kc_session cookie (sent
    // automatically same-origin); we no longer trust a client-supplied userId.
    const s = io({ path: "/socket.io", withCredentials: true });
    setSocket(s);

    s.on("presence", (p: { userId: string; online: boolean }) => {
      setOnline((prev) => {
        const next = new Set(prev);
        p.online ? next.add(p.userId) : next.delete(p.userId);
        return next;
      });
    });

    // Global toasts for file alerts + notifications.
    s.on("file_event", (e: FileEventPayload) => {
      const msg = e.message ?? `${e.fileName} updated`;
      if (e.severity === "warning") toast.warning(msg);
      else toast.success(msg, { description: "File-server alert" });
    });
    s.on("notification", (n: { title?: string; body?: string }) => {
      toast(n.title ?? "Notification", { description: n.body });
    });

    return () => void s.disconnect();
  }, [userId]);

  return <Ctx.Provider value={{ socket, online }}>{children}</Ctx.Provider>;
}
