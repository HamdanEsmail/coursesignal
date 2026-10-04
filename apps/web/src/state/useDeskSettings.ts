import { useCallback, useState } from "react";

const STORAGE_KEY = "lodge.desk.v1";

export type DeskSettings = {
  notebookPresent: boolean;
  reminderArmed: boolean;
  pageWatchEnabled: boolean;
  quietHoursEnabled: boolean;
};

const DEFAULT_SETTINGS: DeskSettings = {
  notebookPresent: true,
  reminderArmed: true,
  pageWatchEnabled: true,
  quietHoursEnabled: true,
};

function readSettings(): DeskSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<DeskSettings>
      | null;
    if (!parsed) return DEFAULT_SETTINGS;
    return {
      notebookPresent:
        typeof parsed.notebookPresent === "boolean"
          ? parsed.notebookPresent
          : DEFAULT_SETTINGS.notebookPresent,
      reminderArmed:
        typeof parsed.reminderArmed === "boolean"
          ? parsed.reminderArmed
          : DEFAULT_SETTINGS.reminderArmed,
      pageWatchEnabled:
        typeof parsed.pageWatchEnabled === "boolean"
          ? parsed.pageWatchEnabled
          : DEFAULT_SETTINGS.pageWatchEnabled,
      quietHoursEnabled:
        typeof parsed.quietHoursEnabled === "boolean"
          ? parsed.quietHoursEnabled
          : DEFAULT_SETTINGS.quietHoursEnabled,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: DeskSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useDeskSettings() {
  const [settings, setSettings] = useState<DeskSettings>(readSettings);

  const updateSettings = useCallback((patch: Partial<DeskSettings>) => {
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
