import { useCallback, useState } from "react";

const STORAGE_KEY = "coursesignal.preview.settings.v1";

export type DemoSettings = {
  watchEnabled: boolean;
  memoryPresent: boolean;
  quietHoursEnabled: boolean;
  retentionDays: 7 | 30;
};

const DEFAULT_SETTINGS: DemoSettings = {
  watchEnabled: true,
  memoryPresent: true,
  quietHoursEnabled: true,
  retentionDays: 7,
};

function readSettings(): DemoSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<DemoSettings>
      | null;

    if (!parsed) return DEFAULT_SETTINGS;

    return {
      watchEnabled:
        typeof parsed.watchEnabled === "boolean"
          ? parsed.watchEnabled
          : DEFAULT_SETTINGS.watchEnabled,
      memoryPresent:
        typeof parsed.memoryPresent === "boolean"
          ? parsed.memoryPresent
          : DEFAULT_SETTINGS.memoryPresent,
      quietHoursEnabled:
        typeof parsed.quietHoursEnabled === "boolean"
          ? parsed.quietHoursEnabled
          : DEFAULT_SETTINGS.quietHoursEnabled,
      retentionDays: parsed.retentionDays === 30 ? 30 : 7,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: DemoSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useDemoSettings() {
  const [settings, setSettings] = useState<DemoSettings>(readSettings);

  const updateSettings = useCallback((patch: Partial<DemoSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      persistSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return { settings, updateSettings, resetSettings };
}
