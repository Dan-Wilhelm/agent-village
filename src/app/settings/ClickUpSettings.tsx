"use client";

import { useActionState, useState, useTransition } from "react";

import {
  connectClickUp,
  disconnectClickUp,
  saveClickUpSpaces,
  selectClickUpWorkspace,
  syncClickUpNow,
  type ActionState,
} from "./actions";

interface AccountView {
  userName: string;
  teamId: string | null;
  teamName: string | null;
  selectedSpaceIds: string[];
  lastFullSyncAt: string | null;
  lastSyncError: string | null;
  liveUpdates: boolean;
  taskCount: number;
}

function Message({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role="status" className={`mt-3 text-sm font-bold ${state.ok ? "text-leaf" : "text-berry"}`}>
      {state.message}
    </p>
  );
}

export function ClickUpSettings({
  account,
  teams,
  spaces,
  loadError,
}: {
  account: AccountView | null;
  teams: Array<{ id: string; name: string }>;
  spaces: Array<{ id: string; name: string; color: string | null }>;
  loadError: string | null;
}) {
  const [connectState, connectAction, connecting] = useActionState(connectClickUp, null);
  const [teamState, teamAction, savingTeam] = useActionState(selectClickUpWorkspace, null);
  const [spacesState, spacesAction, savingSpaces] = useActionState(saveClickUpSpaces, null);
  const [miscState, setMiscState] = useState<ActionState>(null);
  const [busy, startTransition] = useTransition();
  const [showTokenForm, setShowTokenForm] = useState(!account);

  return (
    <section className="cozy-card p-6" aria-labelledby="clickup-heading">
      <h2 id="clickup-heading" className="text-xl font-black text-wood-dark">
        ClickUp
      </h2>
      <p className="mt-1 text-sm text-ink/70">
        Your agents read your ClickUp tasks from a private copy in your own database. The token is encrypted and
        never sent to the browser.
      </p>

      {account && (
        <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-bold">Connected as</dt>
          <dd>{account.userName}</dd>
          <dt className="font-bold">Workspace</dt>
          <dd>{account.teamName ?? "—"}</dd>
          <dt className="font-bold">Open tasks synced</dt>
          <dd>{account.taskCount}</dd>
          <dt className="font-bold">Last full sync</dt>
          <dd>{account.lastFullSyncAt ? new Date(account.lastFullSyncAt).toLocaleString() : "never"}</dd>
          <dt className="font-bold">Live updates</dt>
          <dd>{account.liveUpdates ? "on (webhook)" : "off — catch-up sync every 15 minutes"}</dd>
          {account.lastSyncError && (
            <>
              <dt className="font-bold text-berry">Last error</dt>
              <dd className="text-berry">{account.lastSyncError}</dd>
            </>
          )}
        </dl>
      )}
      {loadError && <p className="mt-3 text-sm font-bold text-berry">{loadError}</p>}

      {/* 1. Token */}
      {showTokenForm ? (
        <form action={connectAction} className="mt-6 flex flex-col gap-2" autoComplete="off">
          <label htmlFor="token" className="text-sm font-black">
            {account ? "Replace personal API token" : "1. Personal API token"}
          </label>
          <p className="text-xs text-ink/70">
            In ClickUp: avatar → Settings → Apps → API Token → Generate / Copy. It starts with <code>pk_</code>.
          </p>
          <div className="flex gap-2">
            <input
              id="token"
              name="token"
              type="password"
              required
              spellCheck={false}
              autoComplete="off"
              placeholder="pk_…"
              className="min-w-0 flex-1 rounded-xl border-2 border-wood bg-white px-3 py-2 font-mono text-sm"
            />
            <button type="submit" disabled={connecting} className="cozy-button bg-leaf px-4 py-2 text-sm disabled:opacity-60">
              {connecting ? "Checking…" : "Connect"}
            </button>
          </div>
          <Message state={connectState} />
        </form>
      ) : (
        <button type="button" onClick={() => setShowTokenForm(true)} className="mt-4 text-sm font-bold text-wood underline">
          Replace token
        </button>
      )}

      {/* 2. Workspace */}
      {account && teams.length > 0 && (
        <form action={teamAction} className="mt-6 flex flex-col gap-2">
          <label htmlFor="teamId" className="text-sm font-black">
            2. ClickUp workspace
          </label>
          <div className="flex gap-2">
            <select
              id="teamId"
              name="teamId"
              defaultValue={account.teamId ?? ""}
              className="min-w-0 flex-1 rounded-xl border-2 border-wood bg-white px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Choose…
              </option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={savingTeam} className="cozy-button bg-parchment px-4 py-2 text-sm disabled:opacity-60">
              {savingTeam ? "Saving…" : "Use"}
            </button>
          </div>
          <Message state={teamState} />
        </form>
      )}

      {/* 3. Spaces */}
      {account?.teamId && (
        <form action={spacesAction} className="mt-6 flex flex-col gap-2">
          <fieldset>
            <legend className="text-sm font-black">3. Spaces to sync</legend>
            <p className="text-xs text-ink/70">Only these spaces are copied and visible to your agents.</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {spaces.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="spaceId" value={s.id} defaultChecked={account.selectedSpaceIds.includes(s.id)} />
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color ?? "#ccc" }} aria-hidden />
                  {s.name}
                </label>
              ))}
              {spaces.length === 0 && <p className="text-sm text-ink/60">No spaces found.</p>}
            </div>
          </fieldset>
          <div>
            <button type="submit" disabled={savingSpaces} className="cozy-button bg-leaf px-4 py-2 text-sm disabled:opacity-60">
              {savingSpaces ? "Saving & syncing… (can take a minute)" : "Save & sync"}
            </button>
          </div>
          <Message state={spacesState} />
        </form>
      )}

      {/* Maintenance */}
      {account && (
        <div className="mt-8 flex flex-wrap gap-3 border-t-2 border-parchment pt-4">
          <button
            type="button"
            disabled={busy || !account.teamId}
            onClick={() => startTransition(async () => setMiscState(await syncClickUpNow()))}
            className="cozy-button bg-parchment px-4 py-2 text-sm disabled:opacity-60"
          >
            {busy ? "Working…" : "Sync now"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Disconnect ClickUp and delete all cached ClickUp data?")) return;
              startTransition(async () => {
                setMiscState(await disconnectClickUp());
                setShowTokenForm(true);
              });
            }}
            className="cozy-button bg-berry/20 px-4 py-2 text-sm disabled:opacity-60"
          >
            Disconnect
          </button>
          <Message state={miscState} />
        </div>
      )}
    </section>
  );
}
