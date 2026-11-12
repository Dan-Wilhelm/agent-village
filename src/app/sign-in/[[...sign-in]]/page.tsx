import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 bg-gradient-to-b from-sky to-parchment p-4">
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight text-wood-dark">Agent Village</h1>
        <p className="mt-1 text-ink/70">Your agents are waiting for you.</p>
      </div>
      {/* SignIn reads the URL, so it streams in after prerendering (Cache Components). */}
      <Suspense fallback={<p className="text-ink/60">Loading sign-in…</p>}>
        <SignIn />
      </Suspense>
    </main>
  );
}
