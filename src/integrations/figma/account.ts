import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/db";
import { decryptSecret, secretContext } from "@/lib/crypto/secrets";

import { createFigmaClient, type FigmaClient } from "./client";

export type FigmaAccount = typeof schema.figmaAccounts.$inferSelect;

/** The Figma account of ONE company (agents of other companies never get it). */
export async function getFigmaAccount(companyId: string): Promise<FigmaAccount | null> {
  const rows = await getDb().select().from(schema.figmaAccounts).where(eq(schema.figmaAccounts.companyId, companyId)).limit(1);
  return rows[0] ?? null;
}

export async function listFigmaAccounts(): Promise<FigmaAccount[]> {
  return getDb().select().from(schema.figmaAccounts);
}

/** API client with the decrypted token (in memory for this request only). */
export function figmaClientFor(account: FigmaAccount): FigmaClient {
  return createFigmaClient(decryptSecret(account.tokenCiphertext, secretContext.figmaToken(account.id)));
}
