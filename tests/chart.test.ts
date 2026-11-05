import { expect, test } from 'bun:test';
import { chartSeries } from '../lib/chart.ts';

const reading = (at: string, powerW: number, energyTodayKwh: number) => ({
  updatedAt: Date.parse(at), powerW, energyTodayKwh,
});

test('uses the newest reading in each minute for the daily curve', () => {
  const rows = [
    reading('2026-11-04T12:00:50Z', 2500, 2),
    reading('2026-11-04T12:00:10Z', 2000, 1),
  ];
  expect(chartSeries(rows, 'day', 'UTC')).toEqual([
    { label: '12:00', value: 2500, timestamp: rows[0].updatedAt },
  ]);
});

test('takes each daily maximum before summing months for the yearly curve', () => {
  const rows = [
    reading('2026-11-01T12:00:00Z', 1000, 2),
    reading('2026-11-01T18:00:00Z', 0, 5),
    reading('2026-11-02T12:00:00Z', 1000, 3),
    reading('2026-11-01T10:00:00Z', 1000, 1),
    reading('2026-10-31T12:00:00Z', 0, 0),
  ];
  expect(chartSeries(rows, 'month', 'UTC').find(point => point.label === '2026-11-01')?.value).toBe(5);
  expect(chartSeries(rows, 'year', 'UTC').map(point => [point.label, point.value])).toEqual([
    ['2026-10', 0], ['2026-11', 8],
  ]);
});
