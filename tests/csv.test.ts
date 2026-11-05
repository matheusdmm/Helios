import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { CSV_HEADER, csvLine, summaryLine, parseSolisCsv } from '../lib/csv.ts';

const sample = {
  sn: '180206022C190273', firmware: '800037', modelCode: '206',
  updatedAt: Date.parse('2026-10-27T13:55:00.000Z'),
  powerW: 3880, energyTodayKwh: 10.5, energyTotalKwh: null,
  temperatureC: 60.9, alarm: 'NO',
};

test('CSV export and import preserve Brazilian decimals, timestamp and serial', () => {
  const csv = `\uFEFF${CSV_HEADER.join(';')}\r\n${csvLine(sample)}`;
  assert.match(csv, /10,5;;60,9/);
  const parsed = parseSolisCsv(csv, { expectedSerial: sample.sn, now: sample.updatedAt + 60000 });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].updatedAt, sample.updatedAt);
  assert.equal(parsed[0].energyTodayKwh, sample.energyTodayKwh);
  assert.equal(parsed[0].energyTotalKwh, null);
  assert.equal(parsed[0].sn, sample.sn);
});

test('import rejects data from another inverter and malformed readings', () => {
  const csv = `${CSV_HEADER.join(';')}\r\n${csvLine(sample)}`;
  assert.throws(() => parseSolisCsv(csv, { expectedSerial: '180206022C190274' }), /não corresponde/);
  assert.throws(() => parseSolisCsv(csv.replace('3880', '99999')), /fora do intervalo/);
});

test('text fields cannot start a spreadsheet formula', () => {
  const csv = `${CSV_HEADER.join(';')}\r\n${csvLine({ ...sample, alarm: '=2+2' })}`;
  assert.match(csv, /"'=2\+2"/);
  assert.equal(parseSolisCsv(csv)[0].alarm, '=2+2');
});

test('daily summary reports observed peak and tariff value', () => {
  const line = summaryLine('2026-10-27', [sample, { ...sample, updatedAt: sample.updatedAt + 60000, powerW: 3500, energyTodayKwh: 10.8, temperatureC: 61.2 }], 0.9);
  assert.match(line, /^2026-10-27;10,8;3880;2026-10-27T13:55:00\.000Z;61,2;2;2;9,72\r\n$/);
});
