import { describe, expect, it } from "vitest";

import { labelForUrl, tokenize } from "@/ui/conversations/rich-text";

describe("agent text rendering", () => {
  it("turns Markdown links and bare URLs into short hyperlinks", () => {
    const t = tokenize("Ready since 17 Nov, [Drive](https://drive.google.com/drive/folders/1CmA_dhUnulPm2jQRkm4) and https://app.frame.io/reviews/abc.");
    expect(t).toEqual([
      { kind: "text", text: "Ready since 17 Nov, " },
      { kind: "link", href: "https://drive.google.com/drive/folders/1CmA_dhUnulPm2jQRkm4", label: "Drive" },
      { kind: "text", text: " and " },
      { kind: "link", href: "https://app.frame.io/reviews/abc", label: "Frame.io" },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps task chips and bold text", () => {
    expect(tokenize("**PREU** [task:1241uyj4a7v]")).toEqual([
      { kind: "bold", text: "PREU" },
      { kind: "text", text: " " },
      { kind: "task", id: "1241uyj4a7v" },
    ]);
  });

  it("never links non-http schemes", () => {
    expect(tokenize("[click](javascript:alert(1))").every((x) => x.kind !== "link")).toBe(true);
  });

  it("labels known services", () => {
    expect(labelForUrl("https://docs.google.com/spreadsheets/d/x")).toBe("Sheet");
    expect(labelForUrl("https://www.figma.com/design/x")).toBe("Figma");
    expect(labelForUrl("https://example.com/a")).toBe("Link");
  });
});
