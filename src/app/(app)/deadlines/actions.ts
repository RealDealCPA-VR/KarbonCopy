"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { broadcast } from "@/server/realtime";
import { generateDeadlines, type GenerateResult } from "@/lib/compliance/generate";
import type { DeadlineStatus } from "@/db/schema";

/** Run the bundled-rule generator across clients. requireWrite. */
export async function runGenerateDeadlines(input?: {
  jurisdictions?: string[];
  createWorkItems?: boolean;
}): Promise<GenerateResult> {
  const user = await requireWrite();
  const result = await generateDeadlines({
    jurisdictions: input?.jurisdictions,
    createWorkItems: input?.createWorkItems ?? false,
    actorId: user.id,
  });
  broadcast("work_updated", { source: "deadlines" });
  revalidatePath("/deadlines");
  revalidatePath("/work");
  return result;
}

/** Update a single deadline's status (mark filed / extended / etc.). */
export async function setDeadlineStatus(id: string, status: DeadlineStatus): Promise<void> {
  const user = await requireWrite();
  const [prev] = await db
    .select()
    .from(schema.complianceDeadlines)
    .where(eq(schema.complianceDeadlines.id, id))
    .limit(1);
  if (!prev) throw new Error("Deadline not found");

  await db
    .update(schema.complianceDeadlines)
    .set({ status })
    .where(eq(schema.complianceDeadlines.id, id));

  // Keep a linked work item in sync when filing closes it out.
  if (prev.workItemId && (status === "filed" || status === "na")) {
    const [done] = await db
      .select()
      .from(schema.workStatuses)
      .where(eq(schema.workStatuses.category, "done"))
      .limit(1);
    if (done) {
      await db
        .update(schema.workItems)
        .set({ statusId: done.id, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.workItems.id, prev.workItemId));
    }
  }

  await db.insert(schema.activities).values({
    actorId: user.id,
    verb: "updated",
    entityKind: "deadline",
    entityId: id,
    summary: `${user.name} marked "${prev.name}" ${status}`,
    meta: { status },
  });

  broadcast("work_updated", { source: "deadlines", id });
  revalidatePath("/deadlines");
}

/** Create a linked work item for a deadline that doesn't have one yet. */
export async function createWorkForDeadline(id: string): Promise<string | null> {
  const user = await requireWrite();
  const [d] = await db
    .select()
    .from(schema.complianceDeadlines)
    .where(eq(schema.complianceDeadlines.id, id))
    .limit(1);
  if (!d) throw new Error("Deadline not found");
  if (d.workItemId) return d.workItemId;

  const [firstStatus] = await db
    .select()
    .from(schema.workStatuses)
    .orderBy(schema.workStatuses.position)
    .limit(1);

  const [created] = await db
    .insert(schema.workItems)
    .values({
      title: d.name,
      organizationId: d.organizationId,
      statusId: firstStatus?.id ?? null,
      dueDate: d.extendedDueDate ?? d.dueDate,
      priority: "normal",
    })
    .returning();

  if (created) {
    await db
      .update(schema.complianceDeadlines)
      .set({ workItemId: created.id })
      .where(eq(schema.complianceDeadlines.id, id));
    await db.insert(schema.activities).values({
      actorId: user.id,
      verb: "created",
      entityKind: "work_item",
      entityId: created.id,
      summary: `${user.name} created work for deadline "${d.name}"`,
    });
    broadcast("work_updated", { id: created.id });
  }
  revalidatePath("/deadlines");
  revalidatePath("/work");
  return created?.id ?? null;
}
