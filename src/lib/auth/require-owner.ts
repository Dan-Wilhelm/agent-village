import "server-only";

import { checkOwner } from "./owner";

/** For server actions: throws unless the caller is the owner. */
export async function requireOwnerAction(): Promise<string> {
  const check = await checkOwner();
  if (!check.ok) throw new Error("Not allowed");
  return check.userId;
}
