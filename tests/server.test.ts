import { expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { csvLine, CSV_HEADER } from '../lib/csv.ts';

class TestResponse {
  status = 200;
  body = '';
  destroyed = false;

  writeHead(status: number) { this.status = status; }
  write(chunk: string) { this.body += chunk; return true; }
  end(chunk = '') { this.body += chunk; }
  destroy() { this.destroyed = true; }
  json() { return JSON.parse(this.body); }
}

test('local API imports CSV and can recover its latest reading', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'helios-api-'));
  const previous = {
    HELIOS_DATA_DIR: process.env.HELIOS_DATA_DIR, S3_IP: process.env.S3_IP,
    S3_PASSWORD: process.env.S3_PASSWORD, TIME_ZONE: process.env.TIME_ZONE,
  };
  try {
    Object.assign(process.env, { HELIOS_DATA_DIR: dataDir, S3_IP: '192.0.2.1', S3_PASSWORD: '', TIME_ZONE: 'UTC' });
    const { handleRequest, loadLatestSample } = await import('../server.ts');
    const request = async (method: string, url: string, body = '', headers: Record<string, string> = {}) => {
      const req = Object.assign(Readable.from(body ? [Buffer.from(body)] : []), {
        method, url, headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])),
        socket: { remoteAddress: '127.0.0.1' },
      });
      const res = new TestResponse();
      await handleRequest(req, res);
      return res;
    };

    const config = await request('GET', '/api/config');
    expect(config.status).toBe(200);
    expect(config.json().configured).toBe(true);
    expect(config.json().canManage).toBe(true);
    expect((await request('GET', '/api/dashboard')).status).toBe(503);

    const prior = Date.now() - 86400000;
    const csv = `${CSV_HEADER.join(';')}\r\n${csvLine({ updatedAt: prior, sn: 'SERIAL1234', firmware: 'FIRMWARE', modelCode: 'S6', powerW: 1000,
      energyTodayKwh: 5, energyTotalKwh: 1190, temperatureC: 32, alarm: 'NO' })}`;
    const importCsv = () => request('POST', '/api/import.csv', csv, { 'Content-Type': 'text/csv', 'X-Local-Setup': '1' });
    expect((await request('POST', '/api/import.csv', csv, { 'Content-Type': 'text/csv' })).status).toBe(403);
    expect((await request('POST', '/api/import.csv', 'bad csv', { 'Content-Type': 'text/csv', 'X-Local-Setup': '1' })).status).toBe(400);
    const imported = await importCsv();
    expect(imported.status).toBe(200);
    expect(imported.json().imported).toBe(1);
    expect((await importCsv()).json().duplicates).toBe(1);
    expect((await request('GET', '/api/export.csv')).body).toContain('SERIAL1234');

    const restored = await loadLatestSample();
    expect(restored?.sn).toBe('SERIAL1234');
    expect(restored?.powerW).toBe(1000);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (!path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test directory');
    await rm(dataDir, { recursive: true, force: true });
  }
}, 15000);
