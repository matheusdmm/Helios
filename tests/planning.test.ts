import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildForecast } from '../lib/planning.ts';

const dayOf = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
const reading = (date: string, energyTodayKwh: number) => ({
  updatedAt: Date.parse(`${date}T16:00:00Z`), energyTodayKwh, powerW: 1000,
});

test('forecast uses recorded prior days and excludes today and old readings', () => {
  const rows = [
    reading('2026-10-01', 100),
    reading('2026-10-28', 2), reading('2026-10-28', 4),
    reading('2026-10-29', 6), reading('2026-10-30', 8),
    reading('2026-10-31', 10), reading('2026-11-01', 12),
    reading('2026-11-04', 99),
  ];
  const result = buildForecast(rows, '2026-11-04', dayOf);
  assert.equal(result.daysUsed, 5);
  assert.equal(result.days[0].date, '2026-11-05');
  assert.equal(result.days[6].date, '2026-11-11');
  assert.equal(result.days[0].energyKwh, 8);
  assert.equal(result.totalKwh, 56);
  assert.ok(result.lowTotalKwh < result.totalKwh);
  assert.ok(result.highTotalKwh > result.totalKwh);
});

test('forecast stays unavailable with sparse history', () => {
  const result = buildForecast([reading('2026-11-01', 5)], '2026-11-04', dayOf);
  assert.equal(result.daysUsed, 1);
  assert.equal(result.totalKwh, null);
  assert.deepEqual(result.days, []);
});
