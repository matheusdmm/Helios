export interface Reading {
  updatedAt: number;
  powerW: number;
  energyTodayKwh: number;
  energyTotalKwh?: number | null;
  temperatureC?: number;
  alarm?: string;
  sn?: string;
  firmware?: string;
  modelCode?: string;
}

export interface Sample extends Reading {
  energyTotalKwh: number | null;
  temperatureC: number;
  alarm: string;
  sn: string;
  firmware: string;
  modelCode: string;
  model: string;
  stationName: string;
  state: 'online' | 'alarm';
  capacityW: number;
}

export interface ConnectionEvent {
  at: number;
  ok: boolean;
}

export interface S3Config {
  s3Ip: string;
  s3User: string;
  s3Password: string;
}
