"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Push-to-talk speech recognition (browser Web Speech API). Only active while
 * the owner holds/toggles the mic button — no always-on listening.
 */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function createRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { SpeechRecognition?: new () => Recognition }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function useVoiceInput(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [lang, setLang] = useState<"de-DE" | "en-US">("de-DE");
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSupported(createRecognition() !== null), 0);
    return () => clearTimeout(t);
  }, []);

  const start = useCallback(() => {
    const r = createRecognition();
    if (!r) return;
    r.lang = lang;
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text.trim()) onText(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }, [lang, onText]);

  const stop = useCallback(() => {
    rec.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, start, stop, lang, setLang };
}
