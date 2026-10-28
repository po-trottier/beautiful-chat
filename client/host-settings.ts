/**
 * Paseo's own app settings record. The plugin SDK carries none of these, so
 * this reads the record the host keeps in `localStorage` on web and desktop.
 * Native clients have no `localStorage`, and every caller falls back to the
 * plugin's own behaviour there.
 */
export interface HostAppSettings {
  uiFontFamily?: unknown;
  monoFontFamily?: unknown;
  toolCallDetailLevel?: unknown;
  compactToolCalls?: unknown;
}

export function readHostAppSettings(): HostAppSettings {
  try {
    const store = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    const raw = store?.getItem("@paseo:app-settings");
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return parsed && typeof parsed === "object" ? (parsed as HostAppSettings) : {};
  } catch {
    return {};
  }
}

/**
 * True when Paseo's Tool call display is Summary (stored as `overview`). Paseo then folds each run of
 * consecutive tool calls into one summary row, but only runs of its own
 * `tool_call` items: a plugin row breaks the run. Older records stored
 * `concise` or `compactToolCalls`, which Paseo reads as Overview.
 */
export function hostToolOverview(): boolean {
  const settings = readHostAppSettings();
  const level = settings.toolCallDetailLevel;
  if (level === "overview" || level === "concise") return true;
  return level === undefined && settings.compactToolCalls === true;
}
