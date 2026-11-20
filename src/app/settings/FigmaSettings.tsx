"use client";

import { useActionState, useTransition } from "react";

import { connectFigma, disconnectFigma, type FigmaActionState } from "./figma-actions";

type Company = { companyId: string; companyName: string; handle: string | null; since: string | null };

/** One Figma account per company (each company can use a different Figma login). */
export function FigmaSettings({ companies }: { companies: Company[] }) {
  return (
    <section className="cozy-card flex flex-col gap-4 p-6" aria-labelledby="figma-heading">
      <div>
        <h2 id="figma-heading" className="text-xl font-black text-wood-dark">
          Figma
        </h2>
        <p className="mt-1 text-sm text-ink/70">
          Agents of a company can read its Figma files (frames, texts, comments), look at frames as images and — if you allow it — propose
          comments written as you. Figma’s API can’t create or change designs. Each company uses its own Figma account.
        </p>
        <details className="mt-2 text-xs text-ink/70">
          <summary className="cursor-pointer font-bold">How to create the token</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>In Figma: your account menu (top left) → Settings → Security → Personal access tokens → Generate new token.</li>
            <li>
              Scopes: <code>current_user:read</code>, <code>file_content:read</code>, <code>file_comments:read</code> and — only if agents may comment —{" "}
              <code>file_comments:write</code>.
            </li>
            <li>Choose an expiry, copy the token (it’s shown only once) and paste it below for the matching company.</li>
          </ol>
        </details>
      </div>
      {companies.map((c) => (
        <CompanyRow key={c.companyId} company={c} />
      ))}
    </section>
  );
}

function CompanyRow({ company: c }: { company: Company }) {
  const [state, action, pending] = useActionState<FigmaActionState, FormData>(connectFigma, null);
  const [disconnecting, start] = useTransition();
  return (
    <div className="rounded-xl bg-parchment/50 p-3">
      <p className="text-sm font-black">
        {c.companyName}
        {c.handle ? (
          <span className="ml-2 rounded-full bg-leaf/30 px-2 py-0.5 text-xs">connected as {c.handle}</span>
        ) : (
          <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/70">not connected</span>
        )}
      </p>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="companyId" value={c.companyId} />
        <input
          name="token"
          type="password"
          autoComplete="off"
          required
          placeholder={c.handle ? "Replace with a new token…" : "figd_…"}
          aria-label={`Figma token for ${c.companyName}`}
          className="wiz-input min-w-0 flex-1"
        />
        <button type="submit" disabled={pending} className="cozy-button bg-leaf px-3 py-1.5 text-sm disabled:opacity-60">
          {pending ? "Checking…" : c.handle ? "Replace" : "Connect"}
        </button>
        {c.handle && (
          <button
            type="button"
            disabled={disconnecting}
            onClick={() => start(async () => void (await disconnectFigma(c.companyId)))}
            className="cozy-button bg-white px-3 py-1.5 text-sm text-berry"
          >
            Disconnect
          </button>
        )}
      </form>
      {state && (
        <p role="status" className={`mt-1 text-xs font-bold ${state.ok ? "text-leaf" : "text-berry"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}
