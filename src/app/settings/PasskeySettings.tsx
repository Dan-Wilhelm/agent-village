"use client";

import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
  deviceType?: string;
}

export function PasskeySettings() {
  const [keys, setKeys] = useState<PasskeyRow[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let cancelled = false;
    authClient.passkey.listUserPasskeys().then((res) => {
      if (!cancelled) setKeys(res.data ? (res.data as PasskeyRow[]) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  async function add() {
    setBusy(true);
    setMessage(null);
    const name = window.prompt("Name for this passkey (e.g. MacBook)", "MacBook") ?? undefined;
    const res = await authClient.passkey.addPasskey({ name: name || undefined });
    setBusy(false);
    if (res?.error) {
      setMessage({ ok: false, text: "The passkey was not added (cancelled or not supported)." });
      return;
    }
    setMessage({ ok: true, text: "Passkey added. You can now sign in with it." });
    reload();
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this passkey? You can still sign in with Google.")) return;
    setBusy(true);
    const res = await authClient.passkey.deletePasskey({ id });
    setBusy(false);
    setMessage(res?.error ? { ok: false, text: "Could not remove the passkey." } : { ok: true, text: "Passkey removed." });
    reload();
  }

  return (
    <section className="cozy-card p-6" aria-labelledby="passkeys-heading">
      <h2 id="passkeys-heading" className="text-xl font-black text-wood-dark">
        Passkeys
      </h2>
      <p className="mt-1 text-sm text-ink/70">
        Sign in with Touch ID / your device instead of Google. Passkeys never leave your device.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {keys === null && <li className="text-sm text-ink/60">Loading…</li>}
        {keys?.length === 0 && <li className="text-sm text-ink/60">No passkeys yet.</li>}
        {keys?.map((k) => (
          <li key={k.id} className="flex items-center gap-3 rounded-xl bg-parchment/60 px-3 py-2 text-sm">
            <span aria-hidden>🔑</span>
            <span className="flex-1 font-bold">{k.name || "Passkey"}</span>
            {k.createdAt && <span className="text-xs text-ink/60">added {new Date(k.createdAt).toLocaleDateString()}</span>}
            <button type="button" disabled={busy} onClick={() => remove(k.id)} className="text-xs font-bold text-berry underline">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy} onClick={add} className="cozy-button mt-4 bg-leaf px-4 py-2 text-sm disabled:opacity-60">
        {busy ? "Working…" : "Add a passkey"}
      </button>
      {message && (
        <p role="status" className={`mt-3 text-sm font-bold ${message.ok ? "text-leaf" : "text-berry"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
