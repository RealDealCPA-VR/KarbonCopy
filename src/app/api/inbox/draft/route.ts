import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { aiEnabled, draftEmailReply } from "@/lib/ai";
import { buildThreadText } from "../thread-text";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!aiEnabled()) {
    return NextResponse.json(
      { error: "AI is disabled. Set ANTHROPIC_API_KEY to enable." },
      { status: 503 },
    );
  }

  let threadId: string | undefined;
  let instruction = "";
  try {
    const body = (await req.json()) as { threadId?: string; instruction?: string };
    threadId = body.threadId;
    instruction = (body.instruction ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!threadId) return NextResponse.json({ error: "Missing threadId." }, { status: 400 });

  let text: string | null;
  try {
    text = await buildThreadText(threadId);
  } catch (err) {
    console.error("[inbox/draft] buildThreadText failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load thread." }, { status: 500 });
  }
  if (!text) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  try {
    const draft = await draftEmailReply(
      text,
      instruction || "Write a helpful, professional reply.",
    );
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: "AI request failed." }, { status: 502 });
  }
}
