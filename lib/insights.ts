import type { ConnectionEvent, Reading } from './types.ts';

interface DaySummary {
  date: string;
  energyKwh: number | null;
  peakW: number | null;
  peakAt: number | null;
  samples: number;
}

interface InsightsInput {
  today: string;
  todayRows: Reading[];
  recentRows: Reading[];
  monthRows: Reading[];
  connectionEvents: ConnectionEvent[];
  tariff: number;
  dayOf: (timestamp: number) => string;
  now?: number;
}

export function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function summarizeDays(rows: Reading[], dayOf: (timestamp: number) => string) {
  const days = new Map<string, DaySummary>();
  for (const row of rows) {
    if (!Number.isFinite(row.updatedAt)) continue;
    const day = dayOf(row.updatedAt);
    const item = days.get(day) || { date: day, energyKwh: null, peakW: null, peakAt: null, samples: 0 };
    if (Number.isFinite(row.energyTodayKwh) && row.energyTodayKwh >= 0) item.energyKwh = Math.max(item.energyKwh ?? 0, row.energyTodayKwh);
    if (Number.isFinite(row.powerW) && (item.peakW === null || row.powerW > item.peakW)) {
      item.peakW = row.powerW;
      item.peakAt = row.updatedAt;
    }
    item.samples++;
    days.set(day, item);
  }
  return days;
}

export function summarizeConnection(events: ConnectionEvent[], now = Date.now()) {
  const recent = events.filter(event => Number.isFinite(event.at) && event.at >= now - 86400000 && event.at <= now);
  const successes = recent.filter(event => event.ok).length;
  const failures = recent.length - successes;
  const lastSuccess = [...events].reverse().find(event => event.ok);
  const lastFailure = [...events].reverse().find(event => !event.ok);
  return {
    attempts24h: recent.length,
    successes24h: successes,
    failures24h: failures,
    successRate24h: recent.length ? Math.round(successes / recent.length * 100) : null,
    lastSuccessAt: lastSuccess?.at ?? null,
    lastFailureAt: lastFailure?.at ?? null,
    minutesSinceSuccess: lastSuccess ? Math.max(0, Math.floor((now - lastSuccess.at) / 60000)) : null,
  };
}

export function buildInsights({ today, todayRows, recentRows, monthRows, connectionEvents, tariff, dayOf, now = Date.now() }: InsightsInput) {
  const recent = summarizeDays(recentRows, dayOf);
  const monthly = summarizeDays(monthRows, dayOf);
  const todayData = recent.get(today) || null;
  const yesterday = recent.get(shiftDay(today, -1)) || null;
  const prior = Array.from({ length: 7 }, (_, index) => recent.get(shiftDay(today, -index - 1)))
    .filter(day => day?.energyKwh !== null && day?.energyKwh !== undefined);
  const average7Kwh = prior.length ? prior.reduce((sum, day) => sum + day.energyKwh, 0) / prior.length : null;
  const monthDays = [...monthly.values()].sort((a, b) => a.date.localeCompare(b.date));
  const monthKwh = monthDays.reduce((sum, day) => sum + (day.energyKwh ?? 0), 0);
  const bestDay = monthDays.filter(day => day.energyKwh !== null).sort((a, b) => b.energyKwh - a.energyKwh)[0] || null;
  const generatingMinutes = todayRows.length ? new Set(todayRows.filter(row => Number.isFinite(row.powerW) && row.powerW > 50)
    .map(row => Math.floor(row.updatedAt / 60000))).size : null;
  const temperature = todayRows.filter(row => Number.isFinite(row.temperatureC) && Number.isFinite(row.updatedAt))
    .map(row => ({ at: row.updatedAt, celsius: row.temperatureC, powerW: row.powerW }))
    .sort((a, b) => a.at - b.at);
  return {
    todayKwh: todayData?.energyKwh ?? null,
    yesterdayKwh: yesterday?.energyKwh ?? null,
    average7Kwh,
    average7Days: prior.length,
    peakW: todayData?.peakW ?? null,
    peakAt: todayData?.peakAt ?? null,
    generatingMinutes,
    monthKwh,
    bestDay,
    calendar: monthDays.map(day => ({ date: day.date, energyKwh: day.energyKwh, samples: day.samples })),
    temperature,
    connection: summarizeConnection(connectionEvents, now),
    tariff,
    estimatedTodayBrl: tariff > 0 && todayData?.energyKwh != null ? todayData.energyKwh * tariff : null,
    estimatedMonthBrl: tariff > 0 && monthDays.length ? monthKwh * tariff : null,
  };
}
