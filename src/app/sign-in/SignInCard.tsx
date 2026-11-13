"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { authClient } from "@/lib/auth-client";

const ERRORS: Record<string, string> = {
  access_denied: "This village belongs to someone else — your account is not allowed here.",
  "account not linked": "This Google account could not be linked. Please use the owner's Google account.",
};

export function SignInCard() {
  const params = useSearchParams();
  const router = useRouter();
  const enter = () => {
    router.replace("/");
    router.refresh();
  };
  const urlError = params.get("error");
  const [error, setError] = useState<string | null>(urlError ? (ERRORS[urlError] ?? "Sign-in failed. Please try again.") : null);
  const [busy, setBusy] = useState<"google" | "passkey" | null>(null);

  // Offer saved passkeys in the browser's autofill (conditional UI), where supported.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await window.PublicKeyCredential?.isConditionalMediationAvailable?.();
      if (!available || cancelled) return;
      const res = await authClient.signIn.passkey({ autoFill: true });
      if (!cancelled && !res?.error) enter();
    })().catch(() => {
      /* autofill is a convenience; ignore */
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  async function google() {
    setBusy("google");
    setError(null);
    const res = await authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" });
    if (res?.error) {
      setError("Google sign-in could not start. Please try again.");
      setBusy(null);
    }
  }

  async function passkey() {
    setBusy("passkey");
    setError(null);
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      setError("Passkey sign-in failed or was cancelled.");
      setBusy(null);
      return;
    }
    enter();
  }

  return (
    <div className="cozy-card w-full max-w-sm p-6">
      <h2 className="text-center text-lg font-black text-wood-dark">Sign in</h2>
      <div className="mt-5 flex flex-col gap-3">
        <button
          type="button"
          onClick={google}
          disabled={busy !== null}
          className="cozy-button flex items-center justify-center gap-2 bg-white px-4 py-2.5 disabled:opacity-60"
        >
          <span aria-hidden className="text-lg font-black text-[#4285F4]">G</span>
          {busy === "google" ? "Opening Google…" : "Continue with Google"}
        </button>
        <button
          type="button"
          onClick={passkey}
          disabled={busy !== null}
          className="cozy-button flex items-center justify-center gap-2 bg-leaf px-4 py-2.5 disabled:opacity-60"
        >
          <span aria-hidden>🔑</span>
          {busy === "passkey" ? "Waiting for your passkey…" : "Sign in with passkey"}
        </button>
        {/* lets the browser suggest saved passkeys (conditional UI) */}
        <input
          type="text"
          name="username"
          autoComplete="username webauthn"
          aria-label="Passkey suggestions"
          className="sr-only"
          tabIndex={-1}
        />
      </div>
      {error && (
        <p role="alert" className="mt-4 text-center text-sm font-bold text-berry">
          {error}
        </p>
      )}
      <p className="mt-5 text-center text-xs text-ink/60">
        Private village — only the owner can enter. Add a passkey in Settings after your first Google sign-in.
      </p>
    </div>
  );
}
