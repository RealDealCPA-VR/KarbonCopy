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

export type RealtimeEvent =
  | { type: "file_event"; payload: unknown }
  | { type: "notification"; payload: unknown }
  | { type: "work_updated"; payload: unknown }
  | { type: "presence"; payload: unknown };

/** Broadcast to everyone on the LAN. */
export function broadcast(event: string, payload: unknown) {
  g.__io?.emit(event, payload);
}

/** Send to a single user's room (room name = `user:<id>`). */
export function emitToUser(userId: string, event: string, payload: unknown) {
  g.__io?.to(`user:${userId}`).emit(event, payload);
}
