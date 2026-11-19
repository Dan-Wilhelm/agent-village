import { describe, expect, it } from "vitest";

import { collectResults, voiceErrorMessage } from "@/ui/voice";

const result = (transcript: string, isFinal: boolean) => Object.assign([{ transcript }], { isFinal });

describe("speech results", () => {
  it("only returns NEW final text (no repeats of earlier sentences) plus the live interim text", () => {
    const results = [result("Erster Satz.", true), result(" Zweiter Satz.", true), result(" und noch", false)];
    expect(collectResults(results, 1)).toEqual({ final: "Zweiter Satz.", interim: "und noch" });
    expect(collectResults(results, 0).final).toBe("Erster Satz. Zweiter Satz.");
  });

  it("explains blocked microphones and ignores pauses", () => {
    expect(voiceErrorMessage("not-allowed")).toMatch(/Microphone access is blocked/);
    expect(voiceErrorMessage("no-speech")).toBeNull();
    expect(voiceErrorMessage("network")).toMatch(/not reachable/);
  });
});
