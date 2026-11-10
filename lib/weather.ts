const stepMs = 3 * 60 * 60 * 1000;

interface WeatherDay {
  date: string;
  cloudPct: number | null;
  minC: number;
  maxC: number;
}

export type WeatherResult =
  | { status: 'ready'; days: WeatherDay[] }
  | { status: 'unconfigured' | 'invalid-location' | 'unauthorized' | 'unavailable' };

export function createWeatherForecast(apiKey: string, lat: string, lon: string, dayOf: (timestamp: number) => string) {
  let cached: { result: WeatherResult; expiresAt: number } | undefined;
  let pending: Promise<WeatherResult> | undefined;

  async function fetchForecast(): Promise<WeatherResult> {
    try {
      const url = new URL('https://api.openweathermap.org/data/2.5/forecast');
      url.search = new URLSearchParams({ lat, lon, appid: apiKey, units: 'metric' }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'error' });
      if (response.status === 401 || response.status === 403) return { status: 'unauthorized' };
      if (!response.ok) return { status: 'unavailable' };
      const data = await response.json();
      if (!Array.isArray(data?.list)) return { status: 'unavailable' };

      const slots = new Map<number, { cloudPct: number; tempC: number; daylight: boolean }>();
      for (const slot of data.list) {
        const at = slot?.dt * 1000;
        const cloudPct = slot?.clouds?.all;
        const tempC = slot?.main?.temp;
        const partOfDay = slot?.sys?.pod;
        if (typeof slot?.dt !== 'number' || at <= 0 || at % stepMs !== 0 || at >= 8.64e15 - stepMs) continue;
        if (!Number.isFinite(cloudPct) || cloudPct < 0 || cloudPct > 100 || !Number.isFinite(tempC)) continue;
        if (partOfDay !== 'd' && partOfDay !== 'n') continue;
        slots.set(at, { cloudPct, tempC, daylight: partOfDay === 'd' });
      }

      const dates = new Map<string, number[]>();
      for (const at of [...slots.keys()].sort((a, b) => a - b)) {
        const date = dayOf(at);
        if (!dates.has(date)) dates.set(date, []);
        dates.get(date)!.push(at);
      }

      const days: WeatherDay[] = [];
      for (const [date, times] of dates) {
        // A complete local day has no missing slots, including at either boundary.
        if (dayOf(times[0] - stepMs) === date || dayOf(times.at(-1)! + stepMs) === date) continue;
        if (times.some((at, index) => index > 0 && at - times[index - 1] !== stepMs)) continue;
        const samples = times.map(at => slots.get(at)!);
        const daylight = samples.filter(sample => sample.daylight);
        const temperatures = samples.map(sample => sample.tempC);
        days.push({
          date,
          cloudPct: daylight.length ? daylight.reduce((sum, sample) => sum + sample.cloudPct, 0) / daylight.length : null,
          minC: Math.min(...temperatures),
          maxC: Math.max(...temperatures),
        });
      }
      return days.length ? { status: 'ready', days } : { status: 'unavailable' };
    } catch {
      return { status: 'unavailable' };
    }
  }

  return async function getWeatherForecast(): Promise<WeatherResult> {
    if (!apiKey) return { status: 'unconfigured' };
    if (!lat || !lon || !(Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180)) {
      return { status: 'invalid-location' };
    }
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    pending ??= fetchForecast().then(result => {
      cached = { result, expiresAt: Date.now() + (result.status === 'ready' ? 600_000 : 60_000) };
      return result;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
