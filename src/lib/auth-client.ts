"use client";

import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

/** Browser-side auth client (same origin). */
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
