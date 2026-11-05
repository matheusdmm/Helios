import { expect, test } from 'bun:test';
import { loadLatestSnapshot, loadPublicConfig, loadSnapshot, savePublicConfig, saveSnapshot } from '../public/offline-store.ts';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  } as Storage;
}

test('keeps recent dashboard copies and finds the latest one when the date changes offline', () => {
  const storage = memoryStorage();
  for (let day = 1; day <= 11; day++) {
    const date = `2026-10-${String(day).padStart(2, '0')}`;
    expect(saveSnapshot(storage, 'day', date, { period: 'day', date, inverter: { powerW: day } }, day)).toBe(true);
  }
  expect(loadSnapshot(storage, 'day', '2026-10-01')).toBeNull();
  expect(loadSnapshot<{ inverter: { powerW: number } }>(storage, 'day', '2026-10-11')?.data.inverter.powerW).toBe(11);
  expect(loadLatestSnapshot<{ date: string }>(storage, 'day')?.data.date).toBe('2026-10-11');
});

test('never stores collector credentials in the public configuration copy', () => {
  const storage = memoryStorage();
  savePublicConfig(storage, { timeZone: 'America/Sao_Paulo', canManage: false, s3Password: 'secret', ip: '192.168.1.2' });
  expect(loadPublicConfig(storage)).toEqual({ timeZone: 'America/Sao_Paulo', canManage: false });
  expect(JSON.stringify([...Array(storage.length)].map((_, index) => storage.getItem(storage.key(index)!)))).not.toContain('secret');
});
