import { Suspense } from "react";

import { SignInCard } from "./SignInCard";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 bg-gradient-to-b from-sky to-parchment p-4">
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight text-wood-dark">Agent Village</h1>
        <p className="mt-1 text-ink/70">Your agents are waiting for you.</p>
      </div>
      {/* reads ?error= from the URL, so it streams in after prerendering (Cache Components) */}
      <Suspense fallback={<div className="cozy-card h-56 w-full max-w-sm" />}>
        <SignInCard />
      </Suspense>
    </main>
  );
}
