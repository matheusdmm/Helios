import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLatestSnapshot, loadPublicConfig, loadSnapshot, savePublicConfig, saveSnapshot } from '../public/offline-store.js';

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test('keeps recent dashboard copies and finds the latest one when the date changes offline', () => {
  const storage = memoryStorage();
  for (let day = 1; day <= 11; day++) {
    const date = `2026-10-${String(day).padStart(2, '0')}`;
    assert.equal(saveSnapshot(storage, 'day', date, { period: 'day', date, inverter: { powerW: day } }, day), true);
  }
  assert.equal(loadSnapshot(storage, 'day', '2026-10-01'), null);
  assert.equal(loadSnapshot(storage, 'day', '2026-10-11')?.data.inverter.powerW, 11);
  assert.equal(loadLatestSnapshot(storage, 'day')?.data.date, '2026-10-11');
});

test('never stores collector credentials in the public configuration copy', () => {
  const storage = memoryStorage();
  savePublicConfig(storage, { timeZone: 'America/Sao_Paulo', canManage: false, s3Password: 'secret', ip: '192.168.1.2' });
  assert.deepEqual(loadPublicConfig(storage), { timeZone: 'America/Sao_Paulo', canManage: false });
  assert.doesNotMatch(storage.getItem(storage.key(0)), /secret|192\.168\.1\.2/);
});
