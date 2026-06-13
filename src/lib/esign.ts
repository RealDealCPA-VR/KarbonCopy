/**
 * E-signature core (offline / LAN).
 *
 * Two responsibilities:
 *   1. A tamper-evident, hash-chained audit trail over `signatureEvents`.
 *   2. Stamping a typed/drawn signature onto a PDF with pdf-lib.
 *
 * No third-party e-sign service is contacted — everything runs in-process on the
 * firm's own server, alongside the rest of KarbonCopy.
 */
import "server-only";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ------------------------------------------------------------------ */
/* Tamper-evident audit chain                                          */
/* ------------------------------------------------------------------ */

export type SignatureEventType = "created" | "sent" | "viewed" | "signed" | "declined";

/**
 * Stable JSON serialization: keys are sorted so the same logical payload always
 * hashes identically regardless of property insertion order. (No nested objects
 * are used in our payloads, so a shallow sort is sufficient.)
 */
function canonicalize(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) obj[k] = payload[k];
  return JSON.stringify(obj);
}

/**
 * The per-event payload that gets folded into the hash chain. Keep this to
 * primitive, stable values — anything non-deterministic (e.g. a Date object's
 * formatting) must be normalized to a number/string first.
 */
export type EventPayload = {
  type: SignatureEventType;
  requestId: string;
  actorName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** unix-ms; pass an explicit value so the stored row and the hash agree. */
  at: number;
  meta?: Record<string, unknown> | null;
};

/**
 * Compute the chained hash for an event:
 *   hash = sha256( prevHash + canonical(payload) )
 *
 * `prevHash` is the previous event's hash (the empty string for the genesis
 * event). Because each hash commits to the prior hash, any retroactive edit to
 * an earlier event breaks every hash that follows it — making tampering evident.
 */
export function chainHash(prevHash: string | null | undefined, payload: EventPayload): string {
  const canonical = canonicalize({
    type: payload.type,
    requestId: payload.requestId,
    actorName: payload.actorName ?? null,
    ip: payload.ip ?? null,
    userAgent: payload.userAgent ?? null,
    at: payload.at,
    meta: payload.meta ? canonicalize(payload.meta) : null,
  });
  return createHash("sha256")
    .update((prevHash ?? "") + canonical)
    .digest("hex");
}

/**
 * Re-derive the chain over an ordered list of events and report whether the
 * stored hashes match. Used by the staff audit view to prove integrity.
 */
export function verifyChain(
  events: Array<{ hash: string | null; payload: EventPayload }>,
): { valid: boolean; brokenAt: number | null } {
  let prev: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const expected = chainHash(prev, events[i].payload);
    if (events[i].hash !== expected) return { valid: false, brokenAt: i };
    prev = events[i].hash;
  }
  return { valid: true, brokenAt: null };
}

/* ------------------------------------------------------------------ */
/* PDF stamping                                                        */
/* ------------------------------------------------------------------ */

export type SignatureStamp = {
  /** The signer's typed legal name (always present). */
  signerName: string;
  /** ISO/locale timestamp string drawn under the signature. */
  signedAtText: string;
  /** Optional PNG data-url of a hand-drawn signature ("data:image/png;base64,..."). */
  drawnSignaturePng?: string | null;
  /** Short verification id (e.g. the request id) printed in the audit footer. */
  verificationId: string;
};

const PNG_DATAURL_RE = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

/** Decode a PNG data-url to bytes, or null if it isn't a well-formed PNG data-url. */
export function decodePngDataUrl(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) return null;
  const m = PNG_DATAURL_RE.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], "base64");
    // Guard against absurd payloads (a normal signature canvas is well under 1MB).
    if (buf.byteLength === 0 || buf.byteLength > 2 * 1024 * 1024) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Stamp the signature block onto the LAST page of the given PDF and append a
 * dedicated certificate/audit page. Returns the new PDF bytes.
 *
 * The stamp is intentionally simple and self-contained (no external fonts/assets)
 * so it works fully offline.
 */
export async function stampSignature(
  pdfBytes: Uint8Array | Buffer | ArrayBuffer,
  stamp: SignatureStamp,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pages = pdf.getPages();
  const last = pages[pages.length - 1];
  const { width } = last.getSize();

  // --- Signature block, bottom-left of the last page ---
  const margin = 48;
  const blockBottom = 56;
  const lineColor = rgb(0.6, 0.6, 0.6);
  const ink = rgb(0.1, 0.1, 0.12);
  const subtle = rgb(0.4, 0.4, 0.45);

  // Draw the optional hand-drawn signature image above the name line.
  const drawn = decodePngDataUrl(stamp.drawnSignaturePng);
  if (drawn) {
    try {
      const png = await pdf.embedPng(drawn);
      const maxW = 200;
      const maxH = 56;
      const scale = Math.min(maxW / png.width, maxH / png.height, 1);
      last.drawImage(png, {
        x: margin,
        y: blockBottom + 28,
        width: png.width * scale,
        height: png.height * scale,
      });
    } catch {
      /* if the image can't be embedded, fall back to the typed name only */
    }
  }

  // Signature line + typed name + timestamp.
  last.drawLine({
    start: { x: margin, y: blockBottom + 22 },
    end: { x: margin + 240, y: blockBottom + 22 },
    thickness: 0.75,
    color: lineColor,
  });
  last.drawText(stamp.signerName, {
    x: margin,
    y: blockBottom + 8,
    size: 11,
    font: helvBold,
    color: ink,
  });
  last.drawText(`Signed electronically · ${stamp.signedAtText}`, {
    x: margin,
    y: blockBottom - 6,
    size: 8,
    font: helv,
    color: subtle,
  });
  last.drawText(`Verification ID: ${stamp.verificationId}`, {
    x: width - margin - 220,
    y: blockBottom - 6,
    size: 7,
    font: helv,
    color: subtle,
  });

  // --- Certificate / audit page appended at the end ---
  const cert = pdf.addPage();
  const { width: cw, height: ch } = cert.getSize();
  let y = ch - 64;

  cert.drawText("Certificate of Electronic Signature", {
    x: 56,
    y,
    size: 18,
    font: helvBold,
    color: ink,
  });
  y -= 12;
  cert.drawLine({
    start: { x: 56, y },
    end: { x: cw - 56, y },
    thickness: 1,
    color: lineColor,
  });
  y -= 32;

  const rows: Array<[string, string]> = [
    ["Signer", stamp.signerName],
    ["Signed at", stamp.signedAtText],
    ["Verification ID", stamp.verificationId],
    ["Signature method", drawn ? "Typed name + drawn signature" : "Typed name"],
    ["Process", "KarbonCopy on-premise e-signature (no third party)"],
  ];
  for (const [label, value] of rows) {
    cert.drawText(label, { x: 56, y, size: 9, font: helvBold, color: subtle });
    cert.drawText(value, { x: 180, y, size: 10, font: helv, color: ink });
    y -= 22;
  }

  y -= 14;
  const disclaimer =
    "This document was signed electronically. The signer consented to do business " +
    "electronically and to be legally bound by this signature. A tamper-evident, " +
    "hash-chained audit trail of this signing is retained by the firm.";
  wrapText(disclaimer, 92).forEach((line) => {
    cert.drawText(line, { x: 56, y, size: 9, font: helv, color: subtle });
    y -= 14;
  });

  return pdf.save();
}

/** Naive word-wrap for the certificate disclaimer (monospace-ish budget). */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
