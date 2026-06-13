import { NextResponse } from "next/server";
import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import type { FileEventStatus } from "@/db/schema";

const { fileEvents, organizations, fileRules } = schema;

/**
 * GET /api/alerts
 *   ?status=new|acknowledged|dismissed
 *   ?org=<organizationId>
 *   ?limit=<n>            (default 100, max 200)
 *   ?before=<ms>          (cursor on detectedAt for pagination)
 *
 * Returns enriched file events for the live feed / audit log.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as FileEventStatus | "all" | null;
  const org = url.searchParams.get("org");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 200);
  const before = url.searchParams.get("before");

  const conds = [];
  if (status && status !== "all") conds.push(eq(fileEvents.status, status));
  if (org) conds.push(eq(fileEvents.organizationId, org));
  if (before) conds.push(lt(fileEvents.detectedAt, new Date(Number(before))));

  const rows = await db
    .select({
      id: fileEvents.id,
      event: fileEvents.event,
      filePath: fileEvents.filePath,
      fileName: fileEvents.fileName,
      sizeBytes: fileEvents.sizeBytes,
      status: fileEvents.status,
      organizationId: fileEvents.organizationId,
      workItemId: fileEvents.workItemId,
      acknowledgedById: fileEvents.acknowledgedById,
      acknowledgedAt: fileEvents.acknowledgedAt,
      detectedAt: fileEvents.detectedAt,
      clientName: organizations.name,
      ruleName: fileRules.name,
      severity: fileRules.severity,
    })
    .from(fileEvents)
    .leftJoin(organizations, eq(fileEvents.organizationId, organizations.id))
    .leftJoin(fileRules, eq(fileEvents.ruleId, fileRules.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(fileEvents.detectedAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextCursor = hasMore ? items[items.length - 1]?.detectedAt?.getTime() : null;

  return NextResponse.json({ items, hasMore, nextCursor });
}
