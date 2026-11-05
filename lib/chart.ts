import type { Reading } from './types.ts';

type Period = 'day' | 'month' | 'year';
interface Point { label: string; value: number; timestamp: number }

export function chartSeries(rows: Reading[], period: Period, timeZone: string): Point[] {
  const groups = new Map<string, Point>();
  const dailyMax = new Map<string, number>();
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFormat = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });

  for (const row of rows) {
    const value = period === 'day' ? row.powerW : row.energyTodayKwh;
    if (!Number.isFinite(row.updatedAt) || !Number.isFinite(value) || value < 0) continue;

    if (period === 'day') {
      const label = timeFormat.format(row.updatedAt);
      const previous = groups.get(label);
      if (!previous || row.updatedAt >= previous.timestamp) groups.set(label, { label, value, timestamp: row.updatedAt });
      continue;
    }

    const parts = Object.fromEntries(dayFormat.formatToParts(row.updatedAt).map(part => [part.type, part.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    if (period === 'month') {
      const previous = groups.get(day);
      if (!previous || value > previous.value) groups.set(day, { label: day, value, timestamp: row.updatedAt });
      continue;
    }

    const previousMax = dailyMax.get(day) ?? 0;
    if (dailyMax.has(day) && value <= previousMax) continue;
    dailyMax.set(day, value);
    const label = day.slice(0, 7);
    const previous = groups.get(label);
    groups.set(label, { label, value: (previous?.value ?? 0) + value - previousMax, timestamp: row.updatedAt });
  }

  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
