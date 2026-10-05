const STORAGE_KEY = 'backrooms_archive_save_v1';
const VALID_QUALITIES = new Set(['Auto', 'Low', 'Medium', 'High']);
const MAX_LEVEL_INDEX = 5;

const DEFAULT_SAVE = {
  currentLevel: 0,
  highestUnlockedLevel: 0,
  seed: 'ARCHIVE-1989',
  deaths: 0,
  completedGame: false,
  settings: {
    quality: 'Auto', // 'Auto' | 'Low' | 'Medium' | 'High'
    sensitivity: 1.0,
    volume: 0.8,
    vhsEnabled: true
  },
  updatedAt: 0
};

function clampInt(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function clampFloat(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeSaveObject(rawObj) {
  if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
    return structuredClone(DEFAULT_SAVE);
  }

  const rawSettings =
    rawObj.settings && typeof rawObj.settings === 'object' && !Array.isArray(rawObj.settings)
      ? rawObj.settings
      : {};

  const currentLevel = clampInt(rawObj.currentLevel, 0, MAX_LEVEL_INDEX, 0);
  const highestUnlockedLevel = Math.max(
    currentLevel,
    clampInt(rawObj.highestUnlockedLevel, 0, MAX_LEVEL_INDEX, 0)
  );
  const deaths = clampInt(rawObj.deaths, 0, 999999, 0);

  let seed = typeof rawObj.seed === 'string' ? rawObj.seed.trim().slice(0, 64) : '';
  if (!seed) seed = DEFAULT_SAVE.seed;

  const quality = VALID_QUALITIES.has(rawSettings.quality)
    ? rawSettings.quality
    : DEFAULT_SAVE.settings.quality;

  const sensitivity = clampFloat(
    rawSettings.sensitivity,
    0.3,
    2.5,
    DEFAULT_SAVE.settings.sensitivity
  );
  const volume = clampFloat(rawSettings.volume, 0.0, 1.0, DEFAULT_SAVE.settings.volume);
  const vhsEnabled =
    typeof rawSettings.vhsEnabled === 'boolean'
      ? rawSettings.vhsEnabled
      : DEFAULT_SAVE.settings.vhsEnabled;

  return {
    currentLevel,
    highestUnlockedLevel,
    seed,
    deaths,
    completedGame: Boolean(rawObj.completedGame),
    settings: {
      quality,
      sensitivity,
      volume,
      vhsEnabled
    },
    updatedAt: clampInt(rawObj.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0)
  };
}

export class SaveManager {
  static load() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return structuredClone(DEFAULT_SAVE);
      }
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw || typeof raw !== 'string') {
        return structuredClone(DEFAULT_SAVE);
      }
      const parsed = JSON.parse(raw);
      return sanitizeSaveObject(parsed);
    } catch {
      return structuredClone(DEFAULT_SAVE);
    }
  }

  static save(partialData = {}) {
    try {
      const current = SaveManager.load();
      const rawMerged = {
        ...current,
        ...(partialData && typeof partialData === 'object' ? partialData : {}),
        settings: {
          ...current.settings,
          ...(partialData &&
          partialData.settings &&
          typeof partialData.settings === 'object'
            ? partialData.settings
            : {})
        },
        updatedAt: Date.now()
      };
      const sanitized = sanitizeSaveObject(rawMerged);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
      }
      return sanitized;
    } catch {
      return structuredClone(DEFAULT_SAVE);
    }
  }

  static resetProgress() {
    const current = SaveManager.load();
    const fresh = sanitizeSaveObject({
      ...structuredClone(DEFAULT_SAVE),
      settings: current.settings,
      updatedAt: Date.now()
    });
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      }
    } catch {
      // ignore storage quota errors
    }
    return fresh;
  }
}
