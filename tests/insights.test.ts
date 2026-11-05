import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildInsights, shiftDay } from '../lib/insights.ts';

const dayOf = timestamp => new Date(timestamp).toISOString().slice(0, 10);
const row = (date, time, energyTodayKwh, powerW, temperatureC = 35) => ({
  updatedAt: Date.parse(`${date}T${time}:00Z`), energyTodayKwh, powerW, temperatureC,
});

test('compares only recorded prior days and keeps today partial', () => {
  const today = '2026-10-27';
  const recentRows = [
    row('2026-10-25', '15:00', 4, 1500),
    row('2026-10-26', '12:00', 5, 2600),
    row('2026-10-26', '16:00', 8, 900),
    row(today, '10:00', 1, 2800, 42),
    row(today, '10:01', 2, 3000, 43),
  ];
  const now = Date.parse(`${today}T10:02:00Z`);
  const connectionEvents = [
    { at: now - 120000, ok: true }, { at: now - 60000, ok: false }, { at: now, ok: true },
  ];
  const insights = buildInsights({ today, todayRows: recentRows.slice(-2), recentRows,
    monthRows: recentRows, connectionEvents, tariff: 0.9, dayOf, now });
  assert.equal(insights.todayKwh, 2);
  assert.equal(insights.yesterdayKwh, 8);
  assert.equal(insights.average7Kwh, 6);
  assert.equal(insights.average7Days, 2);
  assert.equal(insights.peakW, 3000);
  assert.equal(insights.generatingMinutes, 2);
  assert.equal(insights.monthKwh, 14);
  assert.equal(insights.bestDay.date, '2026-10-26');
  assert.equal(insights.estimatedTodayBrl, 1.8);
  assert.equal(insights.connection.successRate24h, 67);
  assert.equal(insights.connection.failures24h, 1);
  const outOfOrder = buildInsights({ today, todayRows: [recentRows[4], recentRows[3]], recentRows,
    monthRows: recentRows, connectionEvents, tariff: 0.9, dayOf, now });
  assert.deepEqual(outOfOrder.temperature.map(point => point.at), [recentRows[3].updatedAt, recentRows[4].updatedAt]);
});

test('crosses month boundary and leaves missing comparisons unavailable', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  const today = '2026-03-01';
  const todayRows = [row(today, '12:00', 3, 2000)];
  const insights = buildInsights({ today, todayRows, recentRows: todayRows,
    monthRows: todayRows, connectionEvents: [], tariff: 0, dayOf });
  assert.equal(insights.yesterdayKwh, null);
  assert.equal(insights.average7Kwh, null);
  assert.equal(insights.connection.successRate24h, null);
  assert.equal(insights.estimatedTodayBrl, null);
});
