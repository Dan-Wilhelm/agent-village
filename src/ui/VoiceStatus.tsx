"use client";

/** What the microphone is hearing right now, or why it stopped. */
export function VoiceStatus({ listening, interim, error, className = "" }: { listening: boolean; interim: string; error: string | null; className?: string }) {
  if (error) {
    return (
      <p role="alert" className={`text-xs font-bold text-berry ${className}`}>
        🎙 {error}
      </p>
    );
  }
  if (!listening) return null;
  return (
    <p aria-live="polite" className={`truncate text-xs italic text-ink/60 ${className}`}>
      🎙 {interim || "Listening… speak now, press the mic again to stop."}
    </p>
  );
}
