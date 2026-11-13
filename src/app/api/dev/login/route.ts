import { NextResponse } from "next/server";
import { betterAuth } from "better-auth/minimal";
import { testUtils } from "better-auth/plugins";

import { randomUUID } from "node:crypto";

import { getDb, schema } from "@/db";
import { authConfig } from "@/lib/auth";

/**
 * DEVELOPMENT ONLY: signs in the owner for automated browser tests.
 * In every other environment (production and preview builds have
 * NODE_ENV=production) this route answers 404 and does nothing. It can only
 * ever sign in the owner (OWNER_EMAIL), and requires a local secret header.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  const secret = process.env.DEV_LOGIN_SECRET;
  if (!secret || request.headers.get("x-dev-login") !== secret) return new NextResponse(null, { status: 404 });

  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return new NextResponse("OWNER_EMAIL missing", { status: 500 });

  const test = betterAuth({ ...authConfig, plugins: [...authConfig.plugins, testUtils()] });
  const ctx = await test.$context;
  let found = await ctx.internalAdapter.findUserByEmail(owner);
  if (!found) {
    // Better Auth's own create paths require a real login request, so create the owner row directly (dev only).
    await getDb()
      .insert(schema.user)
      .values({ id: randomUUID(), email: owner, name: "Owner", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    found = await ctx.internalAdapter.findUserByEmail(owner);
    if (!found) return new NextResponse("could not create owner", { status: 500 });
  }
  const { cookies } = await ctx.test.login({ userId: found.user.id });
  const res = NextResponse.json({ ok: true });
  for (const c of cookies) res.cookies.set(c.name, c.value, { path: c.path ?? "/", httpOnly: true, sameSite: "lax", secure: false });
  return res;
}
