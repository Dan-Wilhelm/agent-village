import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic gate: without a session cookie, pages redirect to /sign-in and
 * APIs answer 401. This does NOT validate the session — every page, server
 * action and route handler must still call checkOwner() / requireOwnerForRoute().
 *
 * Public on purpose (each authenticates its requests itself):
 * - /sign-in and /api/auth/* (the login itself),
 * - /api/dev/* (development only; returns 404 in production builds),
 * - /api/cron/* (Vercel Cron; checks the CRON_SECRET bearer itself),
 * - /sw.js and /manifest.webmanifest (fetched by the browser without cookies; no data).
 */
const PUBLIC = [
  /^\/sign-in$/,
  /^\/api\/auth\//,
  /^\/api\/dev\//,
  /^\/api\/cron\//,
  /^\/sw\.js$/,
  /^\/manifest\.webmanifest$/,
];

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
