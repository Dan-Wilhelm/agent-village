import { describe, expect, it } from "vitest";

import type { ClickUpCustomField } from "@/integrations/clickup/client";
import { apiValueFor, fieldDisplayValue, keyFields, matchesFieldFilter } from "@/integrations/clickup/fields";

const clientCode: ClickUpCustomField = {
  id: "f1",
  name: "Client Code",
  type: "drop_down",
  value: 1,
  type_config: { options: [{ id: "o-enrg", name: "ENRG", orderindex: 0 }, { id: "o-alge", name: "ALGE", orderindex: 1 }] },
};
const format: ClickUpCustomField = {
  id: "f2",
  name: "Format",
  type: "drop_down",
  value: "o-img",
  type_config: { options: [{ id: "o-img", name: "IMG", orderindex: 0 }, { id: "o-vid", name: "VID", orderindex: 1 }] },
};
const countries: ClickUpCustomField = {
  id: "f3",
  name: "Countries",
  type: "labels",
  value: ["l-de", "l-at"],
  type_config: { options: [{ id: "l-de", label: "DE" }, { id: "l-at", label: "AT" }, { id: "l-us", label: "USA" }] },
};
const drive: ClickUpCustomField = { id: "f4", name: "Google Drive", type: "url", value: "https://drive.google.com/x" };
const editor: ClickUpCustomField = { id: "f5", name: "Designer/Video Editor", type: "users", value: [{ id: 1, username: "Kim" }] };
const empty: ClickUpCustomField = { id: "f6", name: "Video Type", type: "drop_down", type_config: { options: [] } };

describe("custom field values", () => {
  it("shows readable values (orderindex or option id) and skips empty ones", () => {
    expect(fieldDisplayValue(clientCode)).toBe("ALGE");
    expect(fieldDisplayValue(format)).toBe("IMG");
    expect(fieldDisplayValue(countries)).toEqual(["DE", "AT"]);
    expect(fieldDisplayValue(editor)).toEqual(["Kim"]);
    expect(keyFields([clientCode, format, drive, editor, empty])).toEqual({
      "Client Code": "ALGE",
      Format: "IMG",
      "Google Drive": "https://drive.google.com/x",
      "Designer/Video Editor": ["Kim"],
    });
  });

  it("filters by readable values, case-insensitive", () => {
    expect(matchesFieldFilter([clientCode, format], { "Client Code": "alge", Format: "IMG" })).toBe(true);
    expect(matchesFieldFilter([clientCode, format], { Format: "VID" })).toBe(false);
    expect(matchesFieldFilter([countries], { Countries: "de" })).toBe(true);
    expect(matchesFieldFilter([format], { "Client Code": "ALGE" })).toBe(false);
  });

  it("converts readable values back for the API and explains mistakes", () => {
    expect(apiValueFor(clientCode, "enrg")).toBe("o-enrg");
    expect(apiValueFor(countries, "DE, USA")).toEqual(["l-de", "l-us"]);
    expect(apiValueFor(drive, "https://frame.io/abc")).toBe("https://frame.io/abc");
    expect(() => apiValueFor(clientCode, "XYZ")).toThrow(/Options: ENRG, ALGE/);
    expect(() => apiValueFor(drive, "not a link")).toThrow(/full link/);
    expect(() => apiValueFor(editor, "Kim")).toThrow(/can't be set/);
  });
});
