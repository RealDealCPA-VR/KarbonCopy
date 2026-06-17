/**
 * ⭐ On-prem Document Understanding — the autonomous intake brain.
 *
 * When a file lands (watcher) or is uploaded, this pipeline runs ENTIRELY on the
 * firm's own hardware:
 *   1. record a documentExtractions row (pending → processing)
 *   2. OCR the file with tesseract.js (local, no native build, no cloud)
 *   3. classify the docType via keyword heuristics — and, only if aiEnabled(),
 *      a Claude classify + field-extraction pass to refine
 *   4. store ocrText + extractedFields + confidence + docType (status: processed)
 *   5. AUTO-MATCH against an open documentRequest for the org, fulfil the fitting
 *      item, link matchedRequestId/matchedWorkItemId (status: matched)
 *   6. broadcast a realtime "extraction" event + notify the relevant users
 *
 * Hard guarantees for the watcher:
 *   - fully async + internally queued (bounded concurrency)
 *   - NEVER throws into the caller (everything is wrapped)
 *   - best-effort + bounded (size cap, per-stage timeouts)
 *
 * Cloud opt-in: Claude is used ONLY when aiEnabled(). Otherwise the pipeline is
 * pure-local tesseract + heuristics. A cloud SaaS structurally cannot OCR
 * SSN-bearing documents on the firm's hardware — this is the local-first moat.
 */
import "server-only";
import { extname, basename } from "node:path";
import { stat, readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { broadcast, emitToUser } from "./realtime";
import { aiEnabled } from "@/lib/ai";
import {
  classifyText,
  extractFields,
  docTypeLabelPatterns,
  DOC_TYPE_LABELS,
  type DocType,
} from "@/lib/ocr";

const {
  documentExtractions,
  documentRequests,
  documents,
  organizations,
  workItems,
  notifications,
  activities,
  users,
} = schema;

/* ------------------------------------------------------------------ */
/* Config / bounds                                                     */
/* ------------------------------------------------------------------ */

/** Skip files larger than this — OCR on huge scans is unbounded work. */
const MAX_OCR_BYTES = 25 * 1024 * 1024; // 25 MB
/** Per-file OCR wall-clock budget. */
const OCR_TIMEOUT_MS = 60_000;
/** Claude refinement budget. */
const AI_TIMEOUT_MS = 30_000;
/** How many OCR jobs may run at once (tesseract is CPU-heavy). */
const MAX_CONCURRENCY = 2;
/** Cap OCR text persisted/handed to the classifier. */
const MAX_TEXT_CHARS = 200_000;

const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".gif",
  ".pnm",
]);
const PDF_EXTS = new Set([".pdf"]);

export type ProcessDocumentInput = {
  sourcePath: string;
  fileEventId?: string | null;
  documentId?: string | null;
  organizationId?: string | null;
};

/* ------------------------------------------------------------------ */
/* Tiny in-process queue (bounded concurrency, survives reloads)       */
/* ------------------------------------------------------------------ */

type QueueState = { active: number; pending: Array<() => void> };
const g = globalThis as unknown as { __kcOcrQueue?: QueueState };
const queue: QueueState = (g.__kcOcrQueue ??= { active: 0, pending: [] });

function acquireSlot(): Promise<void> {
  if (queue.active < MAX_CONCURRENCY) {
    queue.active++;
    return Promise.resolve();
  }
  return new Promise<void>((res) => queue.pending.push(res));
}
function releaseSlot() {
  const next = queue.pending.shift();
  if (next) next();
  else queue.active = Math.max(0, queue.active - 1);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/* OCR                                                                 */
/* ------------------------------------------------------------------ */

type OcrResult =
  | { kind: "ocr"; text: string; engine: string }
  | { kind: "skipped"; reason: string };

/** Run tesseract.js on an image path. Lazy-imported so the watcher can boot
 *  even if the optional dep is unavailable. */
async function ocrImage(path: string): Promise<string> {
  const tesseract = await import("tesseract.js");
  const worker = await tesseract.createWorker("eng");
  try {
    const { data } = await worker.recognize(path);
    return data.text ?? "";
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/**
 * Best-effort text acquisition. Images go through tesseract. PDFs have no local
 * rasterizer available on this deployment, so we try to read an embedded text
 * layer if present and otherwise skip gracefully (filename heuristics still run).
 */
async function acquireText(path: string, ext: string): Promise<OcrResult> {
  if (IMAGE_EXTS.has(ext)) {
    const text = await withTimeout(ocrImage(path), OCR_TIMEOUT_MS, "OCR");
    return { kind: "ocr", text, engine: "tesseract" };
  }

  if (PDF_EXTS.has(ext)) {
    // No PDF rasterizer (poppler/canvas/ffmpeg) on this host. Attempt a crude
    // embedded-text scrape from the raw bytes (works for text-layer PDFs); if
    // that yields nothing usable, skip OCR but keep going on filename signal.
    const text = await tryPdfTextLayer(path);
    if (text.trim().length >= 20) return { kind: "ocr", text, engine: "pdf-text-layer" };
    return {
      kind: "skipped",
      reason: "PDF has no extractable text layer and no rasterizer is available on this host",
    };
  }

  return { kind: "skipped", reason: `Unsupported file type: ${ext || "(none)"}` };
}

/** Extremely conservative embedded-text scrape for text-layer PDFs. Pulls
 *  parenthesised string literals out of content streams. Returns "" on failure. */
async function tryPdfTextLayer(path: string): Promise<string> {
  try {
    const buf = await readFile(path);
    const raw = buf.toString("latin1");
    const out: string[] = [];
    // Tj/TJ operands are parenthesised strings: (Hello) Tj
    const re = /\(((?:\\.|[^\\()])*)\)/g;
    let m: RegExpExecArray | null;
    let budget = 0;
    while ((m = re.exec(raw)) !== null && budget < 50_000) {
      const s = m[1]
        .replace(/\\([()\\])/g, "$1")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ");
      if (s.trim()) {
        out.push(s);
        budget += s.length;
      }
    }
    return out.join(" ").replace(/\s{2,}/g, " ");
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Optional Claude refinement (cloud opt-in only)                      */
/* ------------------------------------------------------------------ */

type AiRefinement = {
  docType?: DocType;
  confidence?: number;
  fields?: Record<string, unknown>;
};

/**
 * Use Claude to confirm the docType and pull a richer (but still safe) field
 * set. Only invoked when aiEnabled(). Failures are swallowed — heuristics stand.
 */
async function aiRefine(text: string): Promise<AiRefinement | null> {
  if (!aiEnabled()) return null;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

    const system =
      "You are an on-prem tax-document classifier for a CPA firm. Classify the OCR'd document and extract key fields. " +
      "Reply with ONLY a compact JSON object, no prose. " +
      'Schema: {"docType": one of ["w2","1099","k1","bank_stmt","8879","id","unknown"], ' +
      '"confidence": number 0..1, "fields": object of small string/number values}. ' +
      "Never output full Social Security Numbers — only the last 4 digits if clearly masked on the document.";

    const res = await withTimeout(
      client.messages.create({
        model,
        max_tokens: 700,
        system,
        messages: [
          {
            role: "user",
            content: `OCR text (may be noisy):\n\n${text.slice(0, 12_000)}`,
          },
        ],
      }),
      AI_TIMEOUT_MS,
      "AI",
    );

    const out = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const json = out.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json) as AiRefinement;
    return parsed;
  } catch (e) {
    console.warn("[ocr] AI refinement skipped:", (e as Error).message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Auto-match to an open document request                              */
/* ------------------------------------------------------------------ */

type MatchResult = {
  requestId: string;
  workItemId?: string | null;
  itemLabel: string;
};

/**
 * Find an open/partial documentRequest for the org whose outstanding item label
 * fits the docType, mark that item fulfilled (+ link the doc), and return the
 * match. Returns null when nothing fits. Best-effort; never throws.
 */
async function autoMatch(
  organizationId: string | null | undefined,
  docType: DocType,
  documentId: string | null | undefined,
): Promise<MatchResult | null> {
  if (!organizationId || docType === "unknown") return null;
  const patterns = docTypeLabelPatterns(docType);
  if (patterns.length === 0) return null;

  try {
    const reqs = await db
      .select()
      .from(documentRequests)
      .where(
        and(
          eq(documentRequests.organizationId, organizationId),
          inArray(documentRequests.status, ["open", "partial"]),
        ),
      );

    for (const req of reqs) {
      const items = Array.isArray(req.items) ? req.items : [];
      const idx = items.findIndex(
        (it) => !it.fulfilled && patterns.some((p) => p.test(it.label)),
      );
      if (idx === -1) continue;

      const nextItems = items.map((it, i) =>
        i === idx ? { ...it, fulfilled: true, documentId: documentId ?? it.documentId } : it,
      );
      const allDone = nextItems.every((it) => it.fulfilled);

      await db
        .update(documentRequests)
        .set({ items: nextItems, status: allDone ? "fulfilled" : "partial" })
        .where(eq(documentRequests.id, req.id));

      return { requestId: req.id, workItemId: req.workItemId, itemLabel: items[idx].label };
    }
  } catch (e) {
    console.warn("[ocr] auto-match failed:", (e as Error).message);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Notify + broadcast                                                  */
/* ------------------------------------------------------------------ */

async function notifyMatch(
  organizationId: string | null | undefined,
  fileName: string,
  docType: DocType,
  match: MatchResult,
) {
  try {
    const recipients = new Set<string>();
    if (organizationId) {
      const [org] = await db
        .select({ ownerId: organizations.ownerId })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      if (org?.ownerId) recipients.add(org.ownerId);
    }
    if (match.workItemId) {
      const [wi] = await db
        .select({ assigneeId: workItems.assigneeId })
        .from(workItems)
        .where(eq(workItems.id, match.workItemId))
        .limit(1);
      if (wi?.assigneeId) recipients.add(wi.assigneeId);
    }
    // fall back to all active users if nobody is specifically responsible
    if (recipients.size === 0) {
      const all = await db.select({ id: users.id }).from(users).where(eq(users.active, true));
      all.forEach((u) => recipients.add(u.id));
    }

    const title = `Auto-filed: ${DOC_TYPE_LABELS[docType]}`;
    const body = `“${fileName}” matched request item “${match.itemLabel}”.`;
    for (const uid of recipients) {
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: uid,
          type: "system",
          title,
          body,
          entityKind: "document",
          entityId: match.requestId,
        })
        .returning();
      if (notif) emitToUser(uid, "notification", notif);
    }
  } catch (e) {
    console.warn("[ocr] notify failed:", (e as Error).message);
  }
}

async function logActivity(
  verb: string,
  extractionId: string,
  summary: string,
  meta?: Record<string, unknown>,
) {
  try {
    await db.insert(activities).values({
      actorId: null,
      verb,
      entityKind: "document",
      entityId: extractionId,
      summary,
      meta,
    });
  } catch {
    /* best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* Public entrypoint                                                   */
/* ------------------------------------------------------------------ */

/**
 * Process one document end-to-end. Inserts/updates a documentExtractions row and
 * returns its id (or null if it could not even be recorded). NEVER throws.
 *
 * Invocation (fire-and-forget from the watcher / upload route):
 *   processDocument({ sourcePath, fileEventId, documentId, organizationId })
 *     .catch(() => {});
 */
export async function processDocument(input: ProcessDocumentInput): Promise<string | null> {
  const { sourcePath } = input;
  let extractionId: string | null = null;

  // 1) record the row up-front so the intake queue shows it immediately.
  try {
    const [row] = await db
      .insert(documentExtractions)
      .values({
        sourcePath,
        documentId: input.documentId ?? null,
        fileEventId: input.fileEventId ?? null,
        organizationId: input.organizationId ?? null,
        status: "pending",
      })
      .returning({ id: documentExtractions.id });
    if (!row) {
      console.error("[ocr] insert returned no row");
      return null;
    }
    extractionId = row.id;
    broadcast("extraction", { id: extractionId, status: "pending", sourcePath });
  } catch (e) {
    console.error("[ocr] could not record extraction:", (e as Error).message);
    return null;
  }

  // Run the heavy work behind the queue, fully guarded.
  await acquireSlot();
  try {
    await runPipeline(extractionId, input);
  } catch (e) {
    console.error("[ocr] pipeline error:", (e as Error).message);
    await markFailed(extractionId, (e as Error).message).catch(() => {});
  } finally {
    releaseSlot();
  }
  return extractionId;
}

async function markFailed(extractionId: string, error: string) {
  await db
    .update(documentExtractions)
    .set({ status: "failed", error: error.slice(0, 500), processedAt: new Date() })
    .where(eq(documentExtractions.id, extractionId));
  broadcast("extraction", { id: extractionId, status: "failed" });
}

async function runPipeline(extractionId: string, input: ProcessDocumentInput) {
  const { sourcePath } = input;
  const fileName = basename(sourcePath);
  const ext = extname(sourcePath).toLowerCase();

  await db
    .update(documentExtractions)
    .set({ status: "processing" })
    .where(eq(documentExtractions.id, extractionId));
  broadcast("extraction", { id: extractionId, status: "processing" });

  // size guard — skip huge files entirely.
  let sizeBytes = 0;
  try {
    sizeBytes = (await stat(sourcePath)).size;
  } catch {
    await markSkipped(extractionId, "Source file is not accessible");
    return;
  }
  if (sizeBytes > MAX_OCR_BYTES) {
    await markSkipped(extractionId, `File too large for OCR (${Math.round(sizeBytes / 1e6)} MB)`);
    return;
  }

  // 2) acquire text (OCR for images, text-layer for PDFs, skip otherwise)
  let acquired: OcrResult;
  try {
    acquired = await acquireText(sourcePath, ext);
  } catch (e) {
    acquired = { kind: "skipped", reason: `OCR failed: ${(e as Error).message}` };
  }

  // For unsupported/failed OCR we still attempt a filename-only classification
  // rather than going totally dark.
  const text = acquired.kind === "ocr" ? acquired.text.slice(0, MAX_TEXT_CHARS) : "";
  const signalText = text.trim().length ? text : fileName;

  // 3) classify — heuristics first (always the floor)
  const heur = classifyText(signalText);
  let docType: DocType = heur.docType;
  let confidence = heur.confidence;
  let fields = extractFields(signalText, docType);
  let engine = acquired.kind === "ocr" ? acquired.engine : "filename";

  // 3b) optional Claude refinement (cloud opt-in)
  if (acquired.kind === "ocr" && text.trim().length >= 40) {
    const ai = await aiRefine(text);
    if (ai) {
      if (ai.docType) docType = ai.docType;
      if (typeof ai.confidence === "number") {
        confidence = Math.max(confidence, Math.min(1, Math.max(0, ai.confidence)));
      }
      if (ai.fields && typeof ai.fields === "object") {
        fields = { ...fields, ...sanitizeAiFields(ai.fields) };
      }
      engine = `${engine}+claude`;
    }
  }

  // 4) persist processed result
  await db
    .update(documentExtractions)
    .set({
      ocrText: text || null,
      docType,
      confidence,
      extractedFields: fields,
      engine,
      status: "processed",
      error: acquired.kind === "skipped" ? acquired.reason : null,
      processedAt: new Date(),
    })
    .where(eq(documentExtractions.id, extractionId));

  broadcast("extraction", {
    id: extractionId,
    status: "processed",
    docType,
    confidence,
    fileName,
    organizationId: input.organizationId ?? null,
  });
  await logActivity("processed", extractionId, `OCR classified ${fileName} as ${DOC_TYPE_LABELS[docType]}`, {
    docType,
    confidence,
    engine,
  });

  // 5) auto-match to an open document request
  const match = await autoMatch(input.organizationId, docType, input.documentId);
  if (match) {
    await db
      .update(documentExtractions)
      .set({
        status: "matched",
        matchedRequestId: match.requestId,
        matchedWorkItemId: match.workItemId ?? null,
      })
      .where(eq(documentExtractions.id, extractionId));

    broadcast("extraction", {
      id: extractionId,
      status: "matched",
      docType,
      fileName,
      matchedRequestId: match.requestId,
    });
    await notifyMatch(input.organizationId, fileName, docType, match);
    await logActivity(
      "matched",
      extractionId,
      `Auto-matched ${fileName} to request item “${match.itemLabel}”`,
      { requestId: match.requestId },
    );
  }
}

async function markSkipped(extractionId: string, reason: string) {
  await db
    .update(documentExtractions)
    .set({ status: "processed", docType: "unknown", confidence: 0, error: reason, engine: "skipped", processedAt: new Date() })
    .where(eq(documentExtractions.id, extractionId));
  broadcast("extraction", { id: extractionId, status: "processed", docType: "unknown" });
}

/** Drop anything that looks like a full SSN from AI-returned fields. */
function sanitizeAiFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/;
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string" && SSN.test(v) && !/last4|ssnLast4/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}
