import { NextResponse, type NextRequest } from "next/server";

// Edge middleware: cheap cookie gate only (no DB here).
// Full session validation happens in the (app) layout.
// Public surface (no staff session): client portal, portal APIs, payment
// webhooks, and the healthcheck. Everything else is staff-gated. Portal routes
// enforce their own client-session auth (kc_portal) where needed.
const PUBLIC = [
  "/login", "/portal", "/api/portal", "/api/webhooks", "/healthz",
  "/_next", "/favicon", "/socket.io",
  // /api/v1 authenticates by API key (Bearer / X-API-Key), not the staff cookie.
  "/api/v1",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Exact match or a proper path-segment prefix only — so `/portal` and
  // `/portal/...` are public but `/portalx` is NOT (which would otherwise slip
  // a staff route past the gate).
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has("kc_session");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
