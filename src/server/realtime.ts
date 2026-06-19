/**
 * Realtime hub — holds the Socket.IO server instance and exposes typed emit
 * helpers used by the watcher, automators, and API routes.
 */
import type { Server as IOServer } from "socket.io";

const g = globalThis as unknown as { __io?: IOServer };

export function setIO(io: IOServer) {
  g.__io = io;
}
export function getIO(): IOServer | undefined {
  return g.__io;
}

/** The set of realtime event names the app emits (keep in sync with the
 *  broadcast()/emitToUser() call sites and the client listeners). */
export type RealtimeEvent =
  | "file_event"
  | "notification"
  | "work_updated"
  | "presence"
  | "anomaly_scan"
  | "document_upload"
  | "extraction"
  | "inbox_message"
  | "signature_event";

/** Broadcast to everyone on the LAN. */
export function broadcast(event: RealtimeEvent, payload: unknown) {
  g.__io?.emit(event, payload);
}

/** Send to a single user's room (room name = `user:<id>`). */
export function emitToUser(userId: string, event: RealtimeEvent, payload: unknown) {
  g.__io?.to(`user:${userId}`).emit(event, payload);
}
