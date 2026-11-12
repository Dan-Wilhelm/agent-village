import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Everything requires a signed-in session, except the sign-in page itself.
 * (Signed, machine-to-machine endpoints such as the ClickUp webhook will be
 * added here explicitly in later phases, each with its own signature check.)
 *
 * NOTE: this only proves *someone* is signed in. Pages and routes must also
 * call `checkOwner()` / `requireOwnerForRoute()` from `@/lib/auth/owner`.
 */
const isPublicRoute = createRouteMatcher(["/sign-in(.*)"]);

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
