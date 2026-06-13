import { NextResponse, type NextRequest } from "next/server";

// Edge middleware: cheap cookie gate only (no DB here).
// Full session validation happens in the (app) layout.
// Public surface (no staff session): client portal, portal APIs, payment
// webhooks, and the healthcheck. Everything else is staff-gated. Portal routes
// enforce their own client-session auth (kc_portal) where needed.
const PUBLIC = [
  "/login", "/portal", "/api/portal", "/api/webhooks", "/healthz",
  "/_next", "/favicon", "/api/socket",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const hasSession = req.cookies.has("kc_session");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
