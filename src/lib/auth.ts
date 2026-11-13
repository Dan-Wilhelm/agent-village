import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { passkey } from "@better-auth/passkey";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/db";
import { normalizeEmail } from "@/lib/auth/owner-rules";

/**
 * Login for a SINGLE owner: Google OAuth or passkeys, nothing else
 * (no email/password, no magic links).
 *
 * Three independent locks keep everyone else out:
 *  1. validateUserInfo — every Google sign-in must be the owner's verified email,
 *  2. databaseHooks.user.create — no other user can ever be created,
 *  3. databaseHooks.session.create — no session for anyone but the owner (covers passkeys).
 * On top of that every page/action runs checkOwner() (src/lib/auth/owner.ts).
 */

const ownerEmail = () => normalizeEmail(process.env.OWNER_EMAIL ?? "");
const deny = () => new APIError("FORBIDDEN", { message: "Not allowed" });
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3100";
const isProd = process.env.NODE_ENV === "production";

function rpIdFor(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

export const authConfig = {
  appName: "Agent Village",
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [baseURL],
  database: drizzleAdapter(getDb(), { provider: "pg", schema, transaction: false }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      prompt: "select_account",
    },
  },
  user: {
    // Runs on every Google sign-in (with the fresh profile from Google).
    validateUserInfo: ({ user }) => {
      const owner = ownerEmail();
      if (!owner || normalizeEmail(user.email ?? "") !== owner || user.emailVerified !== true) {
        return { error: "access_denied", errorDescription: "Not allowed" };
      }
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const owner = ownerEmail();
          if (!owner || normalizeEmail(user.email) !== owner) throw deny();
        },
      },
    },
    session: {
      create: {
        // Read the user straight from our database (independent of the request context).
        before: async (session) => {
          const [user] = await getDb()
            .select({ email: schema.user.email })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1);
          const owner = ownerEmail();
          if (!owner || !user || normalizeEmail(user.email) !== owner) throw deny();
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refreshed at most daily while in use
    cookieCache: { enabled: true, maxAge: 60 }, // a revoked session dies within a minute
  },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
  advanced: { useSecureCookies: isProd },
  plugins: [
    passkey({
      rpID: rpIdFor(baseURL),
      rpName: "Agent Village",
      origin: baseURL,
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    }),
    nextCookies(), // must stay last
  ],
} satisfies BetterAuthOptions;

export const auth = betterAuth(authConfig);
