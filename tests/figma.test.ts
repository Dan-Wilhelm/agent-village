import { describe, expect, it } from "vitest";

import { createFigmaClient, summariseNode } from "@/integrations/figma/client";
import { parseFigmaUrl } from "@/integrations/figma/url";

describe("Figma links", () => {
  it("reads file key and node id from all link types", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/AbCdEf1234567890/HRMT-Statics?node-id=12-345&t=x")).toEqual({ fileKey: "AbCdEf1234567890", nodeId: "12:345" });
    expect(parseFigmaUrl("https://figma.com/file/AbCdEf1234567890/Name")).toEqual({ fileKey: "AbCdEf1234567890", nodeId: null });
    expect(parseFigmaUrl("https://www.figma.com/design/AbCdEf1234567890/X/branch/BrAnCh123456789/X?node-id=1-2")).toEqual({ fileKey: "BrAnCh123456789", nodeId: "1:2" });
    expect(parseFigmaUrl("https://www.figma.com/proto/AbCdEf1234567890/Flow?node-id=3%3A4")).toEqual({ fileKey: "AbCdEf1234567890", nodeId: "3:4" });
  });

  it("rejects non-Figma or malformed links", () => {
    expect(parseFigmaUrl("https://evil.com/design/AbCdEf1234567890/x")).toBeNull();
    expect(parseFigmaUrl("https://www.figma.com/community/file/123")).toBeNull();
    expect(parseFigmaUrl("not a url")).toBeNull();
  });
});

describe("Figma client", () => {
  it("sends the token header and waits once on a short 429", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    let n = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      if (n++ === 0) return new Response("", { status: 429, headers: { "retry-after": "1" } });
      return Response.json({ id: "7", handle: "dan", email: "x@y.z" });
    }) as unknown as typeof fetch;
    const waits: number[] = [];
    const me = await createFigmaClient("figd_test", fetchImpl, async (ms) => void waits.push(ms)).me();
    expect(me.handle).toBe("dan");
    expect(calls[0].headers["X-Figma-Token"]).toBe("figd_test");
    expect(waits).toEqual([1000]);
  });

  it("summarises frames and texts", () => {
    const s = summariseNode({
      id: "0:1",
      name: "Page",
      type: "CANVAS",
      children: [
        { id: "1:2", name: "Feed 1:1", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1080, height: 1080 }, children: [{ id: "1:3", name: "Headline", type: "TEXT", characters: "Invest now" }] },
      ],
    });
    expect(s.frames).toEqual([{ id: "1:2", name: "Feed 1:1", type: "FRAME", size: "1080×1080" }]);
    expect(s.texts).toEqual(["Headline: Invest now"]);
  });
});
