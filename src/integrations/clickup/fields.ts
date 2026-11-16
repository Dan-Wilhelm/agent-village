import type { ClickUpCustomField } from "./client";

/**
 * Pure helpers for ClickUp custom fields: readable values for agents, and the
 * reverse (a readable value → what the API expects) when setting fields.
 */

/** Fields agents see on every task row by default (company profile can override). */
export const DEFAULT_KEY_FIELDS = [
  "Client Code",
  "Format",
  "Video Type",
  "Ad Type",
  "Google Drive",
  "Landing Page URL /Quiz",
  "Live URL",
  "Vibe Preview Link",
  "Setup",
  "Phase",
  "Briefer",
  "Designer/Video Editor",
  "Test Case ID",
];

const optionName = (o: { name?: string | null; label?: string | null }) => o.name ?? o.label ?? "";

/** Human-readable value of a custom field, or null if empty. */
export function fieldDisplayValue(field: ClickUpCustomField): string | number | boolean | string[] | null {
  const v = field.value;
  if (v === undefined || v === null || v === "") return null;
  const options = field.type_config?.options ?? [];
  switch (field.type) {
    case "drop_down": {
      // value is the option's orderindex (number) or, in newer payloads, its id
      const hit = options.find((o) => String(o.orderindex) === String(v) || o.id === String(v));
      return hit ? optionName(hit) : null;
    }
    case "labels": {
      if (!Array.isArray(v) || v.length === 0) return null;
      return v.map((id) => optionName(options.find((o) => o.id === String(id)) ?? {})).filter(Boolean);
    }
    case "users":
    case "people": {
      if (!Array.isArray(v) || v.length === 0) return null;
      return v.map((u) => (u && typeof u === "object" && "username" in u ? String((u as { username: unknown }).username) : "?"));
    }
    case "date": {
      const n = Number(v);
      return Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : null;
    }
    case "checkbox":
      return v === true || v === "true";
    case "number":
    case "currency": {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case "url":
    case "short_text":
    case "text":
    case "email":
    case "phone":
      return typeof v === "string" ? v.slice(0, 500) : null;
    default:
      return null; // formulas, relationships, attachments, buttons: not shown
  }
}

/** Compact {field name: value} for the given field names (empty values are left out). */
export function keyFields(fields: ClickUpCustomField[] | null | undefined, names: string[] = DEFAULT_KEY_FIELDS) {
  const out: Record<string, ReturnType<typeof fieldDisplayValue>> = {};
  for (const f of fields ?? []) {
    if (!names.includes(f.name)) continue;
    const value = fieldDisplayValue(f);
    if (value !== null && !(Array.isArray(value) && value.length === 0)) out[f.name] = value;
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Does the task match all {field: value} filters? Arrays match if any entry equals the value. Case-insensitive. */
export function matchesFieldFilter(fields: ClickUpCustomField[] | null | undefined, filter: Record<string, string>) {
  const entries = Object.entries(filter);
  if (entries.length === 0) return true;
  const shown = keyFields(fields, entries.map(([k]) => k));
  return entries.every(([name, want]) => {
    const have = shown[name];
    if (have === undefined || have === null) return false;
    return Array.isArray(have) ? have.some((x) => norm(String(x)) === norm(want)) : norm(String(have)) === norm(want);
  });
}

/**
 * Converts a readable value into the API value for "Set Custom Field Value".
 * Throws a clear error for unknown fields/options so the agent can correct itself.
 */
export function apiValueFor(field: ClickUpCustomField, value: string): unknown {
  const options = field.type_config?.options ?? [];
  switch (field.type) {
    case "drop_down": {
      const hit = options.find((o) => norm(optionName(o)) === norm(value));
      if (!hit) throw new Error(`“${value}” is not an option of ${field.name}. Options: ${options.map(optionName).join(", ")}`);
      return hit.id;
    }
    case "labels": {
      const wanted = value.split(",").map((x) => x.trim()).filter(Boolean);
      return wanted.map((w) => {
        const hit = options.find((o) => norm(optionName(o)) === norm(w));
        if (!hit) throw new Error(`“${w}” is not an option of ${field.name}. Options: ${options.map(optionName).join(", ")}`);
        return hit.id;
      });
    }
    case "url":
      if (!/^https?:\/\/\S+$/i.test(value)) throw new Error(`${field.name} needs a full link (https://…).`);
      return value;
    case "short_text":
    case "text":
    case "email":
    case "phone":
      return value;
    case "number":
    case "currency": {
      const n = Number(value.replace(",", "."));
      if (!Number.isFinite(n)) throw new Error(`${field.name} needs a number.`);
      return n;
    }
    case "date": {
      const ms = Date.parse(value);
      if (Number.isNaN(ms)) throw new Error(`${field.name} needs a date (YYYY-MM-DD).`);
      return ms;
    }
    case "checkbox":
      return /^(true|yes|ja|1)$/i.test(value);
    default:
      throw new Error(`${field.name} (${field.type}) can't be set automatically — Dan sets it in ClickUp.`);
  }
}
