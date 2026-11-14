"use client";

import { useEffect, useState } from "react";

import { currentSubscription, disablePush, enablePush, pushSupported, sendTestPush } from "@/ui/push";

/** Turns generic push notifications on/off for THIS device and sends a test. */
export function PushSettings() {
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported()) {
      queueMicrotask(() => setState("unsupported"));
      return;
    }
    currentSubscription()
      .then((s) => setState(s ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  const run = async (fn: () => Promise<string>, next?: "on" | "off") => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await fn());
      if (next) setState(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cozy-card flex flex-col gap-3 p-6" aria-labelledby="push-heading">
      <h2 id="push-heading" className="text-xl font-black text-wood-dark">
        Notifications &amp; desktop app
      </h2>
      <p className="text-sm text-ink/70">
        When an agent sets off to your office, this device gets a short notification — only the agent&apos;s name and a
        generic reason, never task content.
      </p>
      {state === "unsupported" && <p className="text-sm font-bold text-berry">This browser does not support notifications.</p>}
      {state === "loading" && <p className="text-sm text-ink/60">Checking…</p>}
      {(state === "on" || state === "off") && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-black ${state === "on" ? "bg-leaf/30 text-ink" : "bg-ink/10 text-ink/70"}`}>
            {state === "on" ? "On for this device" : "Off for this device"}
          </span>
          {state === "off" ? (
            <button type="button" disabled={busy} onClick={() => run(enablePush, "on")} className="cozy-button bg-leaf px-4 py-2 text-sm disabled:opacity-60">
              Turn on
            </button>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => run(sendTestPush)} className="cozy-button bg-leaf px-4 py-2 text-sm disabled:opacity-60">
                Send test
              </button>
              <button type="button" disabled={busy} onClick={() => run(disablePush, "off")} className="cozy-button bg-cream px-4 py-2 text-sm disabled:opacity-60">
                Turn off
              </button>
            </>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="text-sm font-bold text-ink/80">
          {message}
        </p>
      )}
      <p className="text-xs text-ink/60">
        Desktop app: in Chrome use the install icon in the address bar (or ⋮ → Cast, save and share → Install page as
        app); in Safari use File → Add to Dock.
      </p>
    </section>
  );
}
