import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai";
import {
  generateWorkflowPlan,
  WorkflowAiError,
  type FirmContext,
} from "@/lib/ai-workflow";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user, "admin")) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  if (!aiEnabled()) {
    return NextResponse.json(
      { error: "AI is disabled. Set ANTHROPIC_API_KEY to enable." },
      { status: 503 },
    );
  }

  let prompt = "";
  try {
    const body = (await req.json()) as { prompt?: string };
    prompt = (body.prompt ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "Describe the engagement first." }, { status: 400 });
  }

  // Ground the model in THIS firm's actual configuration.
  const [workTypes, statuses, users, firmNameRow] = await Promise.all([
    db
      .select({
        id: schema.workTypes.id,
        name: schema.workTypes.name,
        defaultBudgetMinutes: schema.workTypes.defaultBudgetMinutes,
      })
      .from(schema.workTypes)
      .orderBy(asc(schema.workTypes.name)),
    db
      .select({
        id: schema.workStatuses.id,
        name: schema.workStatuses.name,
        category: schema.workStatuses.category,
      })
      .from(schema.workStatuses)
      .orderBy(asc(schema.workStatuses.position)),
    db
      .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.active, true))
      .orderBy(asc(schema.users.name)),
    db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, "firmName"))
      .limit(1),
  ]);

  const firmContext: FirmContext = {
    firmName: typeof firmNameRow[0]?.value === "string" ? (firmNameRow[0].value as string) : null,
    workTypes,
    statuses,
    users,
  };

  try {
    const plan = await generateWorkflowPlan(prompt, firmContext);
    return NextResponse.json({ plan });
  } catch (err) {
    if (err instanceof WorkflowAiError) {
      const msg = err.message === "AI_DISABLED" ? "AI is disabled. Set ANTHROPIC_API_KEY to enable." : err.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "AI request failed. Please try again." }, { status: 502 });
  }
}
