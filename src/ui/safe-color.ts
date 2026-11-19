/** Only plain hex colours from external data (ClickUp) may reach a style attribute. */
export function safeColor(value: string | null | undefined, fallback: string) {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
}
