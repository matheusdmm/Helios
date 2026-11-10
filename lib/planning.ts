import type { Reading } from './types.ts';
import type { WeatherResult } from './weather.ts';
import { shiftDay, summarizeDays } from './insights.ts';

export function buildForecast(rows: Reading[], today: string, dayOf: (timestamp: number) => string) {
  const first = shiftDay(today, -30);
  const values = [...summarizeDays(rows, dayOf).values()]
    .filter(day => day.date >= first && day.date < today && day.energyKwh !== null)
    .map(day => day.energyKwh as number).sort((a, b) => a - b);
  if (values.length < 5) return { daysUsed: values.length, requiredDays: 5, days: [], totalKwh: null, lowTotalKwh: null, highTotalKwh: null };
  const percentile = (fraction: number) => {
    const position = (values.length - 1) * fraction;
    const lower = Math.floor(position);
    return values[lower] + (values[Math.ceil(position)] - values[lower]) * (position - lower);
  };
  const dailyKwh = percentile(.5);
  const lowKwh = percentile(.2);
  const highKwh = percentile(.8);
  return {
    daysUsed: values.length, requiredDays: 5,
    days: Array.from({ length: 7 }, (_, index) => ({ date: shiftDay(today, index + 1), energyKwh: dailyKwh, lowKwh, highKwh })),
    totalKwh: dailyKwh * 7, lowTotalKwh: lowKwh * 7, highTotalKwh: highKwh * 7,
  };
}

export function buildWeatherProjection(weather: WeatherResult, history: ReturnType<typeof buildForecast> | null, today: string) {
  if (weather.status !== 'ready') return weather;
  const baseline = history?.days[0];
  const days = weather.days.filter(day => day.date > today).map(day => ({
    ...day,
    energyKwh: baseline && day.cloudPct !== null
      ? baseline.highKwh - (baseline.highKwh - baseline.lowKwh) * day.cloudPct / 100
      : null,
  }));
  if (!days.length) return { status: 'unavailable' as const };
  const estimates = days.flatMap(day => day.energyKwh === null ? [] : [day.energyKwh]);
  const totalKwh = estimates.length ? estimates.reduce((sum, energy) => sum + energy, 0) : null;
  return {
    status: 'ready' as const, days, totalKwh,
    averageKwh: totalKwh === null ? null : totalKwh / estimates.length,
    estimatedDays: estimates.length,
  };
}
