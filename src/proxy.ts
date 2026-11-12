import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Everything requires a signed-in session, except:
 * - the sign-in page itself,
 * - machine-to-machine endpoints that authenticate EVERY request themselves:
 *   the ClickUp webhook (HMAC signature) and cron jobs (CRON_SECRET bearer).
 *
 * NOTE: this only proves *someone* is signed in. Pages and routes must also
 * call `checkOwner()` / `requireOwnerForRoute()` from `@/lib/auth/owner`.
 */
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/api/webhooks/clickup", "/api/cron/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
