import { SignOutButton } from "@/ui/SignOutButton";

const MESSAGES = {
  not_owner: {
    title: "This village belongs to someone else",
    body: "Your account is not the owner of this Agent Village instance.",
  },
  misconfigured: {
    title: "The village gate is locked",
    body: "OWNER_EMAIL is not configured on the server, so nobody can enter. Set it to the owner's email address and redeploy.",
  },
} as const;

export function NotAllowed({ reason }: { reason: keyof typeof MESSAGES }) {
  const msg = MESSAGES[reason];
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center p-4">
      <div className="cozy-card max-w-md p-6 text-center">
        <h1 className="text-2xl font-black text-wood-dark">{msg.title}</h1>
        <p className="mt-2 text-ink/80">{msg.body}</p>
        <SignOutButton className="cozy-button mt-5 bg-parchment px-4 py-2" />
      </div>
    </main>
  );
}
