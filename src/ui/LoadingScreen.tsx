export function LoadingScreen({ label = "Waking up the village…" }: { label?: string }) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-gradient-to-b from-sky to-parchment">
      <p className="animate-pulse text-xl font-extrabold text-wood-dark motion-reduce:animate-none">
        {label}
      </p>
    </main>
  );
}
