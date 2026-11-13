import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";

import { getDb, schema } from "@/db";
import { checkOwner } from "@/lib/auth/owner";
import { getClickUpAccount } from "@/integrations/clickup/sync";
import { LoadingScreen } from "@/ui/LoadingScreen";
import { NotAllowed } from "@/ui/NotAllowed";

import { loadClickUpChoices } from "./actions";
import { ClickUpSettings } from "./ClickUpSettings";
import { PasskeySettings } from "./PasskeySettings";

export const maxDuration = 300; // full syncs run inside server actions on this page

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingScreen label="Opening settings…" />}>
      <SettingsGate />
    </Suspense>
  );
}

async function SettingsGate() {
  const check = await checkOwner();
  if (!check.ok) {
    if (check.reason === "signed_out") redirect("/sign-in");
    return <NotAllowed reason={check.reason} />;
  }

  const account = await getClickUpAccount();
  const [choices, taskCount] = await Promise.all([
    account ? loadClickUpChoices() : Promise.resolve({ teams: [], spaces: [] }),
    account
      ? getDb()
          .select({ n: count() })
          .from(schema.clickupTasks)
          .where(eq(schema.clickupTasks.accountId, account.id))
          .then((r) => r[0]?.n ?? 0)
      : Promise.resolve(0),
  ]);

  return (
    <main className="min-h-screen flex-1 bg-gradient-to-b from-sky to-parchment p-4 sm:p-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-black text-wood-dark">Settings</h1>
          <Link href="/" className="cozy-button bg-cream px-4 py-2 text-sm">
            ← Back to the village
          </Link>
        </header>
        <PasskeySettings />
        <ClickUpSettings
          account={
            account
              ? {
                  userName: account.externalUserName,
                  teamId: account.teamId,
                  teamName: account.teamName,
                  selectedSpaceIds: account.selectedSpaceIds,
                  lastFullSyncAt: account.lastFullSyncAt?.toISOString() ?? null,
                  lastSyncError: account.lastSyncError,
                  liveUpdates: Boolean(account.webhookId),
                  taskCount,
                }
              : null
          }
          teams={choices.teams}
          spaces={choices.spaces}
          loadError={"error" in choices ? (choices.error as string) : null}
        />
      </div>
    </main>
  );
}
