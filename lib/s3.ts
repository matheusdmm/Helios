import { isIP } from 'node:net';
import type { S3Config, Sample } from './types.ts';

export function parseTelemetry(raw: string, receivedAt = Date.now()): Sample {
  const clean = String(raw).replace(/\0/g, '').trim();
  if (/<html|unauthorized/i.test(clean)) throw new Error('O coletor retornou uma página de login. Verifique usuário e senha.');
  const fields = clean.split(';');
  if (fields.length < 8) throw new Error('O coletor não retornou os dados esperados em /inverter.cgi.');
  const [sn, firmware, modelCode, temp, power, today, total, alert] = fields;
  if (!sn || /^0+$/.test(sn)) throw new Error('O inversor ainda não enviou dados válidos ao coletor.');
  const numericFields = [temp, power, today];
  if (numericFields.some(value => !value?.trim())) throw new Error('Os dados recebidos do coletor estão incompletos.');
  const values = numericFields.map(Number);
  if (values.some(value => !Number.isFinite(value))) throw new Error('Os dados recebidos do coletor estão incompletos.');
  const [temperatureC, powerW, energyTodayKwh] = values;
  const energyTotalKwh = /^\d+(?:\.\d+)?$/.test(total) ? Number(total) : null;
  if (powerW < 0 || energyTodayKwh < 0 || (energyTotalKwh !== null && energyTotalKwh < 0)) throw new Error('O coletor retornou valores inválidos.');
  const alarm = alert?.trim() || 'NO';
  return {
    sn,
    firmware,
    modelCode,
    model: 'Solis S6-GR1P6K',
    stationName: 'Minha usina solar',
    state: alarm.toUpperCase() === 'NO' ? 'online' : 'alarm',
    alarm,
    updatedAt: receivedAt,
    powerW,
    energyTodayKwh,
    energyTotalKwh,
    temperatureC,
    capacityW: 6000,
  };
}

export async function readS3(config: S3Config): Promise<Sample> {
  if (isIP(config.s3Ip) !== 4) throw new Error('Configure um endereço IPv4 válido para o S3-WIFI-ST.');
  const authorization = Buffer.from(`${config.s3User}:${config.s3Password}`, 'utf8').toString('base64');
  let response;
  try {
    response = await fetch(`http://${config.s3Ip}/inverter.cgi`, {
      headers: { Authorization: `Basic ${authorization}` },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new Error('Não foi possível alcançar o S3-WIFI-ST pela rede. Confira o IP e a conexão Wi-Fi.');
  }
  if (response.status === 401 || response.status === 403) throw new Error('O coletor rejeitou usuário ou senha. Alguns S3-WIFI-ST passam a usar a senha do Wi-Fi da casa na página local.');
  if (!response.ok) throw new Error(`O coletor respondeu HTTP ${response.status}.`);
  const raw = await response.text();
  return parseTelemetry(raw);
}
