import type { Document } from "@/db/schema";

export type OrgLite = { id: string; name: string };

export type FolderLite = {
  id: string;
  name: string;
  parentId: string | null;
  organizationId: string | null;
};

export type DocRow = Document & {
  orgName: string | null;
  uploaderName: string | null;
  workTitle: string | null;
};

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
