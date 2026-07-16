export const libraryColumnOptions = [2, 3, 4, 5, 6] as const;

export type LibraryColumns = (typeof libraryColumnOptions)[number];

export interface LibraryPreferences {
  showAchievements: boolean;
  showTags: boolean;
  columns: LibraryColumns;
  clean: boolean;
}

export const defaultLibraryPreferences: LibraryPreferences = {
  showAchievements: true,
  showTags: true,
  columns: 3,
  clean: false
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLibraryColumns(value: unknown): value is LibraryColumns {
  return typeof value === "number" && libraryColumnOptions.includes(value as LibraryColumns);
}

export function normalizeLibraryPreferences(value: unknown): LibraryPreferences {
  if (!isRecord(value)) return { ...defaultLibraryPreferences };

  return {
    showAchievements:
      typeof value.showAchievements === "boolean"
        ? value.showAchievements
        : defaultLibraryPreferences.showAchievements,
    showTags: typeof value.showTags === "boolean" ? value.showTags : defaultLibraryPreferences.showTags,
    columns: isLibraryColumns(value.columns) ? value.columns : defaultLibraryPreferences.columns,
    clean: typeof value.clean === "boolean" ? value.clean : defaultLibraryPreferences.clean
  };
}

export function parseStoredLibraryPreferences(raw: string | null): LibraryPreferences {
  if (!raw) return { ...defaultLibraryPreferences };

  try {
    return normalizeLibraryPreferences(JSON.parse(raw) as unknown);
  } catch {
    return { ...defaultLibraryPreferences };
  }
}
