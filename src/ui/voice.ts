"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Push-to-talk speech recognition (browser Web Speech API: Chrome uses Google's
 * speech service, Safari Apple's). Only active while the owner has the mic
 * button on — no always-on listening. Long speeches keep going: the browser
 * ends a session after pauses, so we restart it until the owner stops (max 5 min).
 */
type ResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

const MAX_LISTEN_MS = 5 * 60_000;

function createRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { SpeechRecognition?: new () => Recognition }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Splits one result event into NEW final text and the current interim text (no repeats). */
export function collectResults(results: ResultList, resultIndex: number) {
  let final = "";
  let interim = "";
  for (let i = resultIndex; i < results.length; i++) {
    const r = results[i];
    if (r.isFinal) final += r[0].transcript;
    else interim += r[0].transcript;
  }
  return { final: final.trim(), interim: interim.trim() };
}

/** Human message for a speech recognition error (null = ignore, e.g. a pause). */
export function voiceErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it for this site (lock icon in the address bar) and, on a Mac, in System Settings → Privacy & Security → Microphone for your browser.";
    case "audio-capture":
      return "No microphone found. Check that a microphone is connected and selected.";
    case "network":
      return "The browser's speech service is not reachable (it needs an internet connection). Please try again.";
    case "language-not-supported":
      return "This language is not supported by the browser's speech recognition.";
    default:
      return "Speech recognition stopped unexpectedly. Please try again.";
  }
}

export function useVoiceInput(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"de-DE" | "en-US">("de-DE");
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false); // the owner still wants to listen
  const startedAt = useRef(0);
  const onTextRef = useRef(onText);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => {
    const t = setTimeout(() => setSupported(createRecognition() !== null), 0);
    return () => {
      clearTimeout(t);
      wanted.current = false;
      rec.current?.stop();
    };
  }, []);

  const start = useCallback(() => {
    const r = createRecognition();
    if (!r) return;
    r.lang = lang;
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      const { final, interim: now } = collectResults(e.results, e.resultIndex);
      if (final) onTextRef.current(final);
      setInterim(now);
    };
    r.onerror = (e) => {
      const msg = voiceErrorMessage(e.error);
      if (!msg) return; // a pause — onend restarts if still wanted
      wanted.current = false;
      setError(msg);
    };
    r.onend = () => {
      setInterim("");
      // The browser ended the session (pause / length limit): keep going until the owner stops.
      if (wanted.current && Date.now() - startedAt.current < MAX_LISTEN_MS) {
        try {
          r.start();
          return;
        } catch {
          /* fall through: stop */
        }
      }
      wanted.current = false;
      setListening(false);
    };
    rec.current = r;
    wanted.current = true;
    startedAt.current = Date.now();
    setError(null);
    setInterim("");
    try {
      r.start();
      setListening(true);
    } catch {
      wanted.current = false;
      setError("Speech recognition could not start. Please try again.");
    }
  }, [lang]);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop(); // delivers the last final results, then onend
    setListening(false);
  }, []);

  return { supported, listening, interim, error, start, stop, lang, setLang };
}
