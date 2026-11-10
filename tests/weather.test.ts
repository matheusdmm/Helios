import { expect, spyOn, test } from 'bun:test';
import { buildForecast, buildWeatherProjection } from '../lib/planning.ts';
import { createWeatherForecast } from '../lib/weather.ts';

const dateOf = (timestamp: number) => new Date(timestamp - 3 * 3600000).toISOString().slice(0, 10);

test('weather projection uses complete local days, excludes night clouds and shares the upstream request', async () => {
  const start = Date.parse('2026-11-04T12:00:00Z');
  const list = Array.from({ length: 24 }, (_, index) => {
    const at = start + index * 3 * 3600000;
    const date = dateOf(at);
    const hour = new Date(at - 3 * 3600000).getUTCHours();
    const daylight = hour >= 6 && hour < 18;
    return {
      dt: at / 1000,
      sys: { pod: daylight ? 'd' : 'n' },
      clouds: { all: daylight && date === '2026-11-05' ? 0 : 100 },
      main: { temp: daylight ? 29 : 18 },
    };
  });
  const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ list }));
  try {
    const weather = createWeatherForecast('example-key', '-23.55', '-46.63', dateOf);
    const [result, concurrent] = await Promise.all([weather(), weather()]);
    expect(result).toBe(concurrent);
    expect(await weather()).toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://api.openweathermap.org/data/2.5/forecast');
    expect(Object.fromEntries(url.searchParams)).toEqual({ lat: '-23.55', lon: '-46.63', appid: 'example-key', units: 'metric' });

    const today = '2026-11-04';
    const readings = [0, 5, 10, 15, 20].map((energyTodayKwh, index) => ({
      updatedAt: Date.parse(`2026-11-0${index + 1}T15:00:00Z`) - 5 * 86400000,
      energyTodayKwh,
      powerW: 1000,
    }));
    const history = buildForecast(readings, today, dateOf);
    expect(buildWeatherProjection(result, history, today)).toEqual({
      status: 'ready',
      days: [
        { date: '2026-11-05', cloudPct: 0, minC: 18, maxC: 29, energyKwh: 16 },
        { date: '2026-11-06', cloudPct: 100, minC: 18, maxC: 29, energyKwh: 4 },
      ],
      totalKwh: 20, averageKwh: 10, estimatedDays: 2,
    });
    const withoutHistory = buildWeatherProjection(result, null, today);
    expect(withoutHistory.status).toBe('ready');
    if (withoutHistory.status === 'ready') {
      expect(withoutHistory.days.map(day => day.energyKwh)).toEqual([null, null]);
      expect(withoutHistory.averageKwh).toBeNull();
    }
  } finally {
    fetchMock.mockRestore();
  }
});

test('invalid settings skip the request and rejected credentials return a cached safe status', async () => {
  const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('example-key', { status: 401 }));
  try {
    const invalid = createWeatherForecast('example-key', '', '-46.63', dateOf);
    expect(await invalid()).toEqual({ status: 'invalid-location' });
    expect(fetchMock).not.toHaveBeenCalled();

    const rejected = createWeatherForecast('example-key', '0', '0', dateOf);
    expect(buildWeatherProjection(await rejected(), null, '2026-11-04')).toEqual({ status: 'unauthorized' });
    expect(await rejected()).toEqual({ status: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    fetchMock.mockRestore();
  }
});
