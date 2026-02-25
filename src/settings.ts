export interface Settings {
  model: string;
  apiKey: string;
  format: "pytest" | "jest" | "playwright";
  instructions: string;
}

const DEFAULTS: Settings = {
  model: "anthropic/claude-sonnet-4-20250514",
  apiKey: "",
  format: "pytest",
  instructions: "",
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored } as Settings;
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(settings);
}

export function isConfigured(settings: Settings): boolean {
  return settings.apiKey.trim().length > 0;
}
