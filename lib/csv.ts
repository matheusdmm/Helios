import type { Reading, Sample } from './types.ts';

export const CSV_HEADER = ['timestamp', 'power_w', 'energy_today_kwh', 'energy_total_kwh', 'temperature_c', 'alarm', 'serial', 'firmware', 'model_code'];
export const SUMMARY_HEADER = ['date', 'energy_kwh', 'peak_w', 'peak_time', 'max_temperature_c', 'generating_minutes_observed', 'readings', 'estimated_brl'];

function textCell(value, forceText = false) {
  let text = String(value ?? '');
  if (forceText || /^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function numericCell(value) {
  return Number.isFinite(value) ? String(value).replace('.', ',') : '';
}

export function csvLine(sample: Reading) {
  return [
    new Date(sample.updatedAt).toISOString(), numericCell(sample.powerW),
    numericCell(sample.energyTodayKwh), numericCell(sample.energyTotalKwh),
    numericCell(sample.temperatureC), textCell(sample.alarm),
    textCell(sample.sn, true), textCell(sample.firmware), textCell(sample.modelCode),
  ].join(';') + '\r\n';
}

export function summaryLine(day: string, samples: Reading[], tariff = 0) {
  const valid = samples.filter(row => Number.isFinite(row.updatedAt));
  const energy = valid.reduce<number | null>((max, row) => Number.isFinite(row.energyTodayKwh) ? Math.max(max ?? 0, row.energyTodayKwh) : max, null);
  const peak = valid.filter(row => Number.isFinite(row.powerW)).sort((a, b) => b.powerW - a.powerW)[0];
  const maxTemperature = valid.reduce<number | null>((max, row) => Number.isFinite(row.temperatureC) ? Math.max(max ?? -Infinity, row.temperatureC) : max, null);
  const generatingMinutes = new Set(valid.filter(row => row.powerW > 50).map(row => Math.floor(row.updatedAt / 60000))).size;
  return [day, numericCell(energy), numericCell(peak?.powerW), peak ? new Date(peak.updatedAt).toISOString() : '',
    numericCell(maxTemperature), generatingMinutes, valid.length,
    tariff > 0 && energy !== null ? numericCell(Math.round(energy * tariff * 100) / 100) : '',
  ].join(';') + '\r\n';
}

function parseRows(input) {
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false;
  const source = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
    } else if (char === ';') {
      row.push(field); field = ''; afterQuote = false;
    } else if (char === '\n') {
      if (field.endsWith('\r') && !afterQuote) field = field.slice(0, -1);
      row.push(field); field = ''; afterQuote = false;
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else if (char === '"' && field === '' && !afterQuote) {
      quoted = true;
    } else if (char === '\r' && afterQuote && source[i + 1] === '\n') {
      // CRLF after a quoted field.
    } else if (afterQuote) {
      throw new Error(`CSV inválido próximo da linha ${rows.length + 1}.`);
    } else field += char;
  }
  if (quoted) throw new Error('CSV contém um campo entre aspas sem fechamento.');
  if (field || row.length) {
    row.push(field);
    if (row.some(value => value !== '')) rows.push(row);
  }
  return rows;
}

function decimal(text, name, allowBlank = false) {
  if (allowBlank && text === '') return null;
  if (!/^-?\d+(?:[,.]\d+)?$/.test(text)) throw new Error(`Valor inválido na coluna ${name}.`);
  return Number(text.replace(',', '.'));
}

function safeText(text, limit, name) {
  const clean = text.startsWith("'") ? text.slice(1) : text;
  if (clean.length > limit || /[\x00-\x1f\x7f]/.test(clean)) throw new Error(`Valor inválido na coluna ${name}.`);
  return clean;
}

export function parseSolisCsv(input: string, { expectedSerial = null, now = Date.now() }: { expectedSerial?: string | null; now?: number } = {}): Sample[] {
  const rows = parseRows(input);
  if (!rows.length || rows[0].join(';') !== CSV_HEADER.join(';')) throw new Error('Cabeçalho CSV diferente do formato exportado pelo painel.');
  if (rows.length > 500001) throw new Error('O CSV ultrapassa o limite de 500 mil leituras.');
  const samples = [];
  let serialSeen = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length !== CSV_HEADER.length) throw new Error(`A linha ${i + 1} tem ${row.length} colunas; eram esperadas ${CSV_HEADER.length}.`);
    const [timestamp, power, today, total, temperature, alarmText, serialText, firmwareText, modelText] = row;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp)) throw new Error(`Data inválida na linha ${i + 1}.`);
    const updatedAt = Date.parse(timestamp);
    if (!Number.isFinite(updatedAt) || updatedAt < Date.parse('2000-01-01T00:00:00Z') || updatedAt > now + 86400000) throw new Error(`Data fora do intervalo permitido na linha ${i + 1}.`);
    const powerW = decimal(power, 'power_w');
    const energyTodayKwh = decimal(today, 'energy_today_kwh');
    const energyTotalKwh = decimal(total, 'energy_total_kwh', true);
    const temperatureC = decimal(temperature, 'temperature_c');
    if (powerW < 0 || powerW > 12000 || energyTodayKwh < 0 || energyTodayKwh > 200 ||
        (energyTotalKwh !== null && (energyTotalKwh < 0 || energyTotalKwh > 1e8)) || temperatureC < -40 || temperatureC > 120) {
      throw new Error(`Leitura fora do intervalo esperado na linha ${i + 1}.`);
    }
    const alarm = safeText(alarmText, 120, 'alarm') || 'NO';
    const sn = safeText(serialText, 24, 'serial');
    const firmware = safeText(firmwareText, 24, 'firmware');
    const modelCode = safeText(modelText, 24, 'model_code');
    if (!/^[A-Za-z0-9]{10,24}$/.test(sn) || !/^[A-Za-z0-9.-]{1,24}$/.test(firmware) || !/^[A-Za-z0-9.-]{1,24}$/.test(modelCode)) throw new Error(`Identificação inválida na linha ${i + 1}.`);
    if (expectedSerial && sn !== expectedSerial) throw new Error(`O número de série na linha ${i + 1} não corresponde ao inversor conectado.`);
    if (serialSeen && sn !== serialSeen) throw new Error('O CSV contém leituras de mais de um inversor.');
    serialSeen = sn;
    samples.push({ sn, firmware, modelCode, model: 'Solis S6-GR1P6K', stationName: 'Minha usina solar',
      state: alarm.toUpperCase() === 'NO' ? 'online' : 'alarm', alarm, updatedAt, powerW,
      energyTodayKwh, energyTotalKwh, temperatureC, capacityW: 6000 });
  }
  if (!samples.length) throw new Error('O CSV não contém leituras para importar.');
  return samples;
}

