import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { aiEnabled, extractTasks } from "@/lib/ai";
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
  try {
    const body = (await req.json()) as { threadId?: string };
    threadId = body.threadId;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!threadId) return NextResponse.json({ error: "Missing threadId." }, { status: 400 });

  let text: string | null;
  try {
    text = await buildThreadText(threadId);
  } catch (err) {
    console.error("[inbox/extract] buildThreadText failed:", (err as Error).message);
    return NextResponse.json({ error: "Failed to load thread." }, { status: 500 });
  }
  if (!text) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  try {
    const tasks = await extractTasks(text);
    return NextResponse.json({ tasks });
  } catch {
    return NextResponse.json({ error: "AI request failed." }, { status: 502 });
  }
}
