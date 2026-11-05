const PREFIX = 'helios:v1:';
const MAX_SNAPSHOTS = 9;

export interface StoredSnapshot<T = unknown> {
  savedAt: number;
  data: T;
}

function snapshotKey(period: string, date: string) {
  return `${PREFIX}dashboard:${period}:${date}`;
}

function snapshotKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(`${PREFIX}dashboard:`)) keys.push(key);
  }
  return keys;
}

export function saveSnapshot<T>(storage: Storage, period: string, date: string, data: T, savedAt = Date.now()): boolean {
  try {
    storage.setItem(snapshotKey(period, date), JSON.stringify({ savedAt, data }));
    const keys = snapshotKeys(storage);
    if (keys.length > MAX_SNAPSHOTS) {
      const ordered = keys.map(key => {
        try { return { key, savedAt: JSON.parse(storage.getItem(key) || '{}').savedAt || 0 }; }
        catch { return { key, savedAt: 0 }; }
      }).sort((a, b) => a.savedAt - b.savedAt);
      for (const item of ordered.slice(0, keys.length - MAX_SNAPSHOTS)) storage.removeItem(item.key);
    }
    return true;
  } catch { return false; }
}

export function loadSnapshot<T>(storage: Storage, period: string, date: string): StoredSnapshot<T> | null {
  try {
    const snapshot = JSON.parse(storage.getItem(snapshotKey(period, date)) || 'null');
    return snapshot && Number.isFinite(snapshot.savedAt) && snapshot.data?.period === period && snapshot.data?.date === date
      ? snapshot : null;
  } catch { return null; }
}

export function loadLatestSnapshot<T>(storage: Storage, period: string): StoredSnapshot<T> | null {
  try {
    const candidates = snapshotKeys(storage)
      .filter(key => key.startsWith(`${PREFIX}dashboard:${period}:`))
      .map(key => {
        try { return JSON.parse(storage.getItem(key) || 'null'); }
        catch { return null; }
      })
      .filter(snapshot => snapshot && Number.isFinite(snapshot.savedAt) && snapshot.data?.period === period);
    return candidates.sort((a, b) => b.savedAt - a.savedAt)[0] || null;
  } catch { return null; }
}

export function savePublicConfig(storage: Storage, config: Record<string, unknown>): void {
  try {
    storage.setItem(`${PREFIX}config`, JSON.stringify({
      timeZone: config.timeZone,
      configured: config.configured,
      needsPassword: config.needsPassword,
      tariffBrlPerKwh: config.tariffBrlPerKwh,
      canManage: config.canManage,
      source: config.source,
    }));
  } catch { /* Armazenamento indisponível. */ }
}

export function loadPublicConfig(storage: Storage): Record<string, unknown> | null {
  try { return JSON.parse(storage.getItem(`${PREFIX}config`) || 'null'); }
  catch { return null; }
}
