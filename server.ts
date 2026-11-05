import http from 'node:http';
import https from 'node:https';
import { readFile, writeFile, appendFile, mkdir, readdir } from 'node:fs/promises';
import { readFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import readline from 'node:readline';
import { once } from 'node:events';
import { readS3 } from './lib/s3.ts';
import { discoverS3, probeS3 } from './lib/discovery.ts';
import { buildInsights, shiftDay, summarizeDays } from './lib/insights.ts';
import { buildForecast } from './lib/planning.ts';
import { chartSeries } from './lib/chart.ts';
import { CSV_HEADER, SUMMARY_HEADER, csvLine, summaryLine, parseSolisCsv } from './lib/csv.ts';
import type { ConnectionEvent, Reading, Sample } from './lib/types.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');

function loadEnv() {
  try {
    for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
loadEnv();
const dataDir = path.resolve(root, process.env.HELIOS_DATA_DIR || 'data');
const settingsFile = path.join(dataDir, 'local-settings.json');

const config = {
  s3Ip: process.env.S3_IP?.trim() || '',
  s3User: process.env.S3_USER?.trim() || 'admin',
  s3Password: process.env.S3_PASSWORD ?? '',
  s3Mac: '',
  tariffBrlPerKwh: Number(process.env.TARIFF_BRL_PER_KWH || 0),
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  timeZone: process.env.TIME_ZONE || 'America/Sao_Paulo',
  httpsCert: process.env.HTTPS_CERT?.trim() || '',
  httpsKey: process.env.HTTPS_KEY?.trim() || '',
};
try {
  const saved = JSON.parse(readFileSync(settingsFile, 'utf8'));
  if (typeof saved.s3Ip === 'string') config.s3Ip = saved.s3Ip;
  if (typeof saved.s3User === 'string') config.s3User = saved.s3User;
  if (typeof saved.s3Password === 'string') config.s3Password = saved.s3Password;
  if (typeof saved.s3Mac === 'string') config.s3Mac = saved.s3Mac;
  if (Number.isFinite(saved.tariffBrlPerKwh) && saved.tariffBrlPerKwh >= 0) config.tariffBrlPerKwh = saved.tariffBrlPerKwh;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!Number.isFinite(config.tariffBrlPerKwh) || config.tariffBrlPerKwh < 0 || config.tariffBrlPerKwh > 100) {
  throw new Error('TARIFF_BRL_PER_KWH deve estar entre 0 e 100.');
}

function dateInZone(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

let latest: Sample | null = null;
let lastError: string | null = null;
let polling: Promise<void> | null = null;

function isLocalRequest(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}

async function storeSample(sample: Sample) {
  await mkdir(dataDir, { recursive: true });
  await appendFile(path.join(dataDir, `${dateInZone(sample.updatedAt)}.jsonl`), `${JSON.stringify(sample)}\n`);
  await recordConnection(true, sample.updatedAt);
}

async function saveSettings() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsFile, JSON.stringify({
    s3Ip: config.s3Ip, s3User: config.s3User, s3Password: config.s3Password,
    s3Mac: config.s3Mac, tariffBrlPerKwh: config.tariffBrlPerKwh,
  }), { mode: 0o600 });
}

async function recordConnection(ok: boolean, at = Date.now()) {
  await mkdir(dataDir, { recursive: true });
  await appendFile(path.join(dataDir, `connection-${dateInZone(at)}.jsonl`), `${JSON.stringify({ at, ok })}\n`);
}

async function poll() {
  if (!config.s3Ip || polling) return polling;
  if (!config.s3Password) {
    lastError = 'Informe a senha do coletor no painel para iniciar a leitura.';
    return null;
  }
  polling = (async () => {
    try {
      const sample = await readS3(config);
      latest = sample;
      lastError = null;
      await storeSample(sample);
    } catch (error) {
      lastError = error.message;
      console.error(`[S3] ${lastError}`);
      try { await recordConnection(false); } catch (logError) { console.error(logError); }
    } finally { polling = null; }
  })();
  return polling;
}

const sampleFile = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const connectionFile = /^connection-\d{4}-\d{2}-\d{2}\.jsonl$/;

async function dataFiles(pattern: RegExp): Promise<string[]> {
  try { return (await readdir(dataDir)).filter(name => pattern.test(name)).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function readJsonLines<T>(name: string): Promise<T[]> {
  const content = await readFile(path.join(dataDir, name), 'utf8');
  const rows: T[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    try { rows.push(JSON.parse(line)); } catch { /* Ignore incomplete or malformed records. */ }
  }
  return rows;
}

async function readFiles<T>(names: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (const name of names) {
    for (const row of await readJsonLines<T>(name)) rows.push(row);
  }
  return rows;
}

async function samplesFor(period: 'day' | 'month' | 'year', date: string): Promise<Reading[]> {
  const prefix = period === 'day' ? date : period === 'month' ? date.slice(0, 7) : date.slice(0, 4);
  return readFiles((await dataFiles(sampleFile)).filter(name => name.startsWith(prefix)));
}

async function connectionEventsSince(day: string): Promise<ConnectionEvent[]> {
  return readFiles((await dataFiles(connectionFile)).filter(name => name.slice(11, 21) >= day));
}

async function recentSamples(today: string, days = 7): Promise<Reading[]> {
  const first = shiftDay(today, -days);
  return readFiles((await dataFiles(sampleFile)).filter(name => name.slice(0, 10) >= first && name.slice(0, 10) <= today));
}

export async function loadLatestSample(): Promise<Sample | null> {
  for (const name of (await dataFiles(sampleFile)).reverse()) {
    const lines = (await readFile(path.join(dataDir, name), 'utf8')).split(/\r?\n/).reverse();
    for (const line of lines) {
      if (!line) continue;
      try {
        const sample = JSON.parse(line);
        if (typeof sample.sn === 'string' && Number.isFinite(sample.updatedAt) && Number.isFinite(sample.powerW)) {
          return sample;
        }
      } catch { /* Ignora linha interrompida. */ }
    }
  }
  return null;
}

function demo(period: 'day' | 'month' | 'year', date: string) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, hour: '2-digit', hour12: false }).format(new Date()));
  const profile = h => Math.max(0, Math.sin((h - 6) / 12 * Math.PI)) * (0.83 + 0.08 * Math.sin(h * 1.7));
  const powerW = Math.round(profile(hour) * 5600);
  const today = Math.round(Array.from({ length: Math.min(hour, 18) }, (_, i) => profile(i + 6) * 3.4).reduce((a, b) => a + b, 0) * 10) / 10;
  const series = period === 'day'
    ? Array.from({ length: 49 }, (_, i) => ({ label: `${String(6 + Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}`, value: Math.round(profile(6 + i / 4) * 5600) }))
    : period === 'month'
      ? Array.from({ length: 30 }, (_, i) => ({ label: `${date.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`, value: Math.max(0, Math.round((21 + 7 * Math.sin(i * 0.81) + 3 * Math.cos(i * 1.73)) * 10) / 10) }))
      : Array.from({ length: 12 }, (_, i) => ({ label: `${date.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`, value: Math.round(470 + 120 * Math.sin((i - 1) * Math.PI / 6)) }));
  return {
    mode: 'demo', period, date, fetchedAt: Date.now(),
    inverter: { model: 'Solis S6-GR1P6K', stationName: 'Minha usina solar', state: 'online', updatedAt: Date.now(), powerW, energyTodayKwh: today, energyMonthKwh: 428.6, energyTotalKwh: 12842, capacityW: 6000, temperatureC: 34.8, alarm: 'NO' },
    series, alarms: [],
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function importSamples(samples: Sample[]) {
  const byDay = new Map();
  for (const sample of samples) {
    const day = dateInZone(sample.updatedAt);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(sample);
  }
  await mkdir(dataDir, { recursive: true });
  let imported = 0, duplicates = 0;
  for (const [day, candidates] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    const filename = path.join(dataDir, `${day}.jsonl`);
    let existing = '';
    try { existing = await readFile(filename, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const keys = new Set();
    for (const line of existing.split(/\r?\n/)) {
      if (!line) continue;
      try { const row = JSON.parse(line); keys.add(`${row.updatedAt}|${row.sn}`); } catch { /* ignora linha interrompida */ }
    }
    const additions = [];
    for (const sample of candidates.sort((a, b) => a.updatedAt - b.updatedAt)) {
      const key = `${sample.updatedAt}|${sample.sn}`;
      if (keys.has(key)) { duplicates++; continue; }
      keys.add(key);
      additions.push(JSON.stringify(sample));
    }
    if (additions.length) await appendFile(filename, `${additions.join('\n')}\n`);
    imported += additions.length;
  }
  return { imported, duplicates, days: byDay.size };
}

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/helios.css', ['helios.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/manifest.en.webmanifest', ['manifest.en.webmanifest', 'application/manifest+json']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']],
]);

export const handleRequest = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/discover' && req.method === 'GET') {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'Busca permitida apenas neste computador.' });
      const result = await discoverS3();
      return json(res, 200, result);
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      if (!isLocalRequest(req) || req.headers['x-local-setup'] !== '1') {
        return json(res, 403, { error: 'Configuração permitida apenas neste computador.' });
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString('utf8');
        if (body.length > 4096) return json(res, 413, { error: 'Configuração muito grande.' });
      }
      let settings;
      try { settings = JSON.parse(body); } catch { return json(res, 400, { error: 'Configuração inválida.' }); }
      const ip = String(settings.ip || '').trim();
      const password = settings.password ? String(settings.password) : config.s3Password;
      if (isIP(ip) !== 4) return json(res, 400, { error: 'Informe um IP válido do coletor.' });
      if (!password || password.length > 256) return json(res, 400, { error: 'Informe a senha do coletor.' });
      const identity = await probeS3(ip);
      if (!identity?.solis) return json(res, 400, { error: 'O IP não respondeu como coletor Solis. A senha não foi enviada.' });
      let sample;
      try { sample = await readS3({ ...config, s3Ip: ip, s3Password: password }); }
      catch (error) { return json(res, 400, { error: error.message, connected: false }); }
      const mac = typeof settings.mac === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(settings.mac) ? settings.mac.toLowerCase() : (ip === config.s3Ip ? config.s3Mac : '');
      if (polling) await polling;
      config.s3Ip = ip;
      config.s3Password = password;
      config.s3Mac = mac;
      await saveSettings();
      latest = sample;
      lastError = null;
      await storeSample(sample);
      return json(res, 200, { saved: true, connected: true, error: null });
    }
    if (url.pathname === '/api/preferences' && req.method === 'POST') {
      if (!isLocalRequest(req) || req.headers['x-local-setup'] !== '1') {
        return json(res, 403, { error: 'Configuração permitida apenas neste computador.' });
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString('utf8');
        if (body.length > 256) return json(res, 413, { error: 'Configuração muito grande.' });
      }
      let input;
      try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Configuração inválida.' }); }
      const tariff = Number(input?.tariffBrlPerKwh);
      if (!Number.isFinite(tariff) || tariff < 0 || tariff > 100) return json(res, 400, { error: 'Informe uma tarifa entre R$ 0 e R$ 100 por kWh.' });
      config.tariffBrlPerKwh = tariff;
      await saveSettings();
      return json(res, 200, { saved: true, tariffBrlPerKwh: tariff });
    }
    if (url.pathname === '/api/import.csv' && req.method === 'POST') {
      if (!isLocalRequest(req) || req.headers['x-local-setup'] !== '1') return json(res, 403, { error: 'Importação permitida apenas neste computador.' });
      if (!config.s3Ip) return json(res, 400, { error: 'Conecte um coletor antes de importar leituras.' });
      if (!String(req.headers['content-type'] || '').startsWith('text/csv')) return json(res, 415, { error: 'Envie um arquivo CSV.' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 100 * 1024 * 1024) return json(res, 413, { error: 'O CSV deve ter até 100 MB.' });
        chunks.push(chunk);
      }
      let samples;
      try {
        const content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        samples = parseSolisCsv(content, { expectedSerial: latest?.sn || null });
      } catch (error) { return json(res, 400, { error: error.message }); }
      return json(res, 200, await importSamples(samples));
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });
    if (url.pathname === '/api/config') return json(res, 200, { configured: Boolean(config.s3Ip), needsPassword: Boolean(config.s3Ip) && !config.s3Password, ip: config.s3Ip, mac: config.s3Mac, timeZone: config.timeZone, tariffBrlPerKwh: config.tariffBrlPerKwh, canManage: isLocalRequest(req) });
    if (url.pathname === '/api/export.csv') {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'Exportação permitida apenas neste computador.' });
      const scope = ['month', 'summary'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'all';
      const prefix = scope === 'month' ? dateInZone().slice(0, 7) : '';
      const relevant = (await dataFiles(sampleFile)).filter(name => name.startsWith(prefix));
      const filename = scope === 'summary' ? `solis-resumo-diario-${dateInZone()}.csv` : `solis-leituras-${scope === 'month' ? prefix : 'completo'}-${dateInZone()}.csv`;
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      });
      try {
        res.write(`\uFEFF${(scope === 'summary' ? SUMMARY_HEADER : CSV_HEADER).join(';')}\r\n`);
        for (const name of relevant) {
          if (scope === 'summary') {
            const samples = await readJsonLines<Reading>(name);
            if (samples.length && !res.write(summaryLine(name.slice(0, 10), samples, config.tariffBrlPerKwh))) await once(res, 'drain');
            continue;
          }
          const lines = readline.createInterface({ input: createReadStream(path.join(dataDir, name)), crlfDelay: Infinity });
          for await (const line of lines) {
            if (!line || res.destroyed) continue;
            try {
              const sample = JSON.parse(line);
              if (!res.write(csvLine(sample))) await once(res, 'drain');
            } catch (error) {
              if (error instanceof SyntaxError || error instanceof RangeError) continue;
              throw error;
            }
          }
        }
        res.end();
      } catch (error) { console.error(error); res.destroy(error); }
      return;
    }
    if (url.pathname === '/api/dashboard') {
      const requestedPeriod = url.searchParams.get('period');
      const period: 'day' | 'month' | 'year' = requestedPeriod === 'month' || requestedPeriod === 'year' ? requestedPeriod : 'day';
      const date = /^20\d{2}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : dateInZone();
      if (!config.s3Ip) return json(res, 200, demo(period, date));
      if (url.searchParams.get('refresh') === '1') await poll();
      if (!latest && !polling) await poll();
      const today = dateInZone();
      const [rows, todayRows, monthRows, recentRows, connectionEvents] = await Promise.all([
        samplesFor(period, date), samplesFor('day', today), samplesFor('month', today),
        recentSamples(today), connectionEventsSince(shiftDay(today, -1)),
      ]);
      const insights = buildInsights({ today, todayRows, monthRows, recentRows, connectionEvents,
        tariff: config.tariffBrlPerKwh, dayOf: dateInZone });
      return json(res, latest ? 200 : 503, {
        mode: 'local', period, date, fetchedAt: Date.now(), inverter: latest ? { ...latest, energyMonthKwh: insights.monthKwh } : null,
        series: chartSeries(rows, period, config.timeZone),
        insights,
        alarms: latest?.alarm && latest.alarm.toUpperCase() !== 'NO'
          ? [{ message: latest.alarm, beganAt: latest.updatedAt }] : [],
        error: lastError,
      });
    }
    if (url.pathname === '/api/calendar') {
      const today = dateInZone();
      const requestedMonth = url.searchParams.get('month') || today.slice(0, 7);
      const month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : today.slice(0, 7);
      if (!config.s3Ip) return json(res, 200, { mode: 'demo', month, today, days: [], forecast: null });
      const [monthRows, recentRows] = await Promise.all([
        samplesFor('month', `${month}-01`), recentSamples(today, 30),
      ]);
      const days = [...summarizeDays(monthRows, dateInZone).values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(day => ({ date: day.date, energyKwh: day.energyKwh, samples: day.samples }));
      return json(res, 200, { mode: 'local', month, today, days, forecast: buildForecast(recentRows, today, dateInZone) });
    }
    const asset = assets.get(url.pathname);
    if (!asset) return json(res, 404, { error: 'Página não encontrada.' });
    const content = await readFile(path.join(publicDir, asset[0]));
    res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Erro ao carregar o painel.' });
  }
};

if (Boolean(config.httpsCert) !== Boolean(config.httpsKey)) {
  throw new Error('Configure HTTPS_CERT e HTTPS_KEY juntos.');
}
const secure = Boolean(config.httpsCert);
const server = secure
  ? https.createServer({
      cert: readFileSync(path.resolve(root, config.httpsCert)),
      key: readFileSync(path.resolve(root, config.httpsKey)),
    }, handleRequest)
  : http.createServer(handleRequest);

async function startServer() {
  if (config.s3Ip) latest = await loadLatestSample();
  server.listen(config.port, config.host, () => {
    console.log(`Painel Solis: ${secure ? 'https' : 'http'}://${config.host}:${config.port}`);
    if (!config.s3Ip) console.log('Prévia com dados de exemplo. Use “Localizar coletor” no painel para conectar.');
    else void poll();
    setInterval(() => { void poll(); }, 60000);
  });
}
if (import.meta.main) void startServer();
