/**
 * Claude integration — optional. Enables AI email drafting, work summaries,
 * and task extraction. No-ops gracefully when ANTHROPIC_API_KEY is unset.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function complete(system: string, user: string, maxTokens = 1024): Promise<string> {
  if (!aiEnabled()) throw new Error("AI_DISABLED");
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function draftEmailReply(thread: string, instruction: string) {
  return complete(
    "You are a professional CPA firm assistant. Draft concise, warm, accurate client emails. Never invent tax figures.",
    `Email thread:\n${thread}\n\nWrite a reply. Instruction: ${instruction}`,
  );
}

export function summarizeThread(thread: string) {
  return complete(
    "Summarize accounting client communications into 2-3 crisp bullet points and a suggested next action.",
    thread,
    400,
  );
}

export async function extractTasks(text: string): Promise<string[]> {
  const out = await complete(
    "Extract actionable tasks from the text. Reply with one task per line, no numbering, no commentary.",
    text,
    600,
  );
  return out
    .split("\n")
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
}
