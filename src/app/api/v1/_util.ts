/**
 * Shared helpers for the /api/v1 REST surface. Every route delegates to a pure
 * service fn via `handle(req, fn)`, which resolves the API-key actor, maps the
 * result to `{ data }`, and maps any thrown error to `{ error: {...} }`.
 *
 * NOTE: /api/v1 authenticates via API key (Authorization: Bearer / X-API-Key),
 * NOT the kc_session cookie. It must be excluded from the middleware cookie
 * redirect that guards browser routes (handled by the coordinator, not here).
 */
import { NextResponse } from "next/server";
import { requireActor, type ApiActor } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";

type Handler<T> = (actor: ApiActor, req: Request) => Promise<T>;

/**
 * Wrap a route handler: authenticate, run, and serialize success/error.
 * @param status success status code (default 200; use 201 for creates)
 */
export async function handle<T>(req: Request, fn: Handler<T>, status = 200): Promise<NextResponse> {
  try {
    const actor = await requireActor(req);
    const data = await fn(actor, req);
    return NextResponse.json({ data }, { status });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { error: { code: "internal", message } },
      { status: 500 },
    );
  }
}

/** Parse a JSON request body, tolerating an empty body (→ {}). */
export async function body(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Collect query params into a plain object suitable for service `list*` inputs.
 * Picks the standard pagination keys plus any extra filter keys requested.
 */
export function query(req: Request, extra: string[] = []): Record<string, string> {
  const sp = new URL(req.url).searchParams;
  const out: Record<string, string> = {};
  for (const key of ["limit", "offset", "search", ...extra]) {
    const val = sp.get(key);
    if (val !== null) out[key] = val;
  }
  return out;
}

/** Read a single query param. */
export function param(req: Request, key: string): string | null {
  return new URL(req.url).searchParams.get(key);
}
