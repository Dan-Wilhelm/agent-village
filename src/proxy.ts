import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic gate: without a session cookie, pages redirect to /sign-in and
 * APIs answer 401. This does NOT validate the session — every page, server
 * action and route handler must still call checkOwner() / requireOwnerForRoute().
 *
 * Public on purpose (each authenticates its requests itself):
 * - /sign-in and /api/auth/* (the login itself),
 * - /api/webhooks/clickup (HMAC signature), /api/cron/* (CRON_SECRET bearer),
 * - /api/dev/* (development only; returns 404 in production builds).
 */
const PUBLIC = [/^\/sign-in$/, /^\/api\/auth\//, /^\/api\/webhooks\/clickup$/, /^\/api\/cron\//, /^\/api\/dev\//];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)"],
};
