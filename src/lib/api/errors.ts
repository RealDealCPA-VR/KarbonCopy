/**
 * Transport-agnostic API errors. REST maps `.status`; MCP maps to an error
 * result. Safe to import anywhere (no Next, no server-only).
 */
export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "internal";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;
  details?: unknown;
  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = "Resource") => new ApiError("not_found", `${what} not found`);
export const forbidden = (msg = "Insufficient permissions") => new ApiError("forbidden", msg);
export const validation = (msg: string, details?: unknown) => new ApiError("validation", msg, details);
