import type { Sample } from '../lib/types.ts';
import type { buildInsights } from '../lib/insights.ts';
import type { buildForecast } from '../lib/planning.ts';

export type Period = 'day' | 'month' | 'year';

export interface PublicConfig extends Record<string, unknown> {
  timeZone: string;
  canManage: boolean;
  configured?: boolean;
  hasPassword?: boolean;
  needsPassword?: boolean;
  ip?: string;
  mac?: string;
  tariffBrlPerKwh?: number;
}

export interface DashboardData {
  mode: 'demo' | 'local';
  period: Period;
  date: string;
  fetchedAt?: number;
  inverter: (Partial<Sample> & { energyMonthKwh?: number }) | null;
  series: Array<{ label: string; value: number; timestamp?: number }>;
  insights?: Partial<ReturnType<typeof buildInsights>>;
  alarms?: Array<{ message: string; beganAt: number }>;
  error?: string | null;
}

export interface CalendarData {
  mode: 'demo' | 'local';
  month: string;
  today?: string;
  days: Array<{ date: string; energyKwh: number | null; samples: number }>;
  forecast: ReturnType<typeof buildForecast> | null;
}

export interface Device {
  ip: string;
  mac?: string | null;
  status?: number | null;
  solis: boolean;
}

export interface DiscoveryData {
  subnets: string[];
  devices: Device[];
  error?: string;
}
