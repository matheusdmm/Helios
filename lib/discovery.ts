import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function isPrivate(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function localSubnets() {
  const found = new Set<string>();
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (/wsl|virtual|hyper-v|vpn|tunnel|vethernet/i.test(name)) continue;
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal || !isPrivate(address.address)) continue;
      // Limit discovery to the local /24. This avoids scanning a large VPN/WSL range.
      found.add(`${address.address.split('.').slice(0, 3).join('.')}.0/24`);
    }
  }
  return [...found];
}

interface ProbeResult {
  ip: string;
  status: number;
  realm: string;
  solis: boolean;
}

async function probe(ip: string): Promise<ProbeResult | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`http://${ip}/inverter.cgi`, {
          headers: { 'User-Agent': 'solis-local-discovery/1.0' },
          redirect: 'manual',
          cache: 'no-store',
          signal: controller.signal,
        });
        const realm = (response.headers.get('www-authenticate') || '').match(/realm="?([^",]+)"?/i)?.[1] || '';
        let preview = '';
        const reader = response.body?.getReader();
        if (reader) {
          while (preview.length < 2048) {
            const { done, value } = await reader.read();
            if (done) break;
            preview += Buffer.from(value).toString('latin1');
          }
          void reader.cancel().catch(() => {});
        }
        const telemetry = /^\x00*\d{10,};[^;]+;[^;]+;/.test(preview);
        return { ip, status: response.status, realm, solis: /solis/i.test(realm) || telemetry };
      })(),
      new Promise<null>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(null); }, 1100);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

export async function probeS3(ip) {
  return probe(ip);
}

async function arpDevices(subnets) {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync('arp.exe', ['-a'], { timeout: 3000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const prefixes = subnets.map(subnet => subnet.slice(0, -4));
    const devices = [];
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+/i);
      if (!match || !prefixes.some(prefix => match[1].startsWith(prefix))) continue;
      const last = Number(match[1].split('.').at(-1));
      const mac = match[2].replaceAll('-', ':').toLowerCase();
      if (last < 1 || last > 254 || mac.startsWith('01:') || mac === 'ff:ff:ff:ff:ff:ff') continue;
      devices.push({ ip: match[1], mac });
    }
    return devices;
  } catch { return []; }
}

export async function discoverS3() {
  const subnets = localSubnets();
  const ips = subnets.flatMap(subnet => {
    const prefix = subnet.slice(0, -4);
    return Array.from({ length: 254 }, (_, i) => `${prefix}${i + 1}`);
  }).slice(0, 508);
  let cursor = 0;
  const found = [];
  await Promise.all(Array.from({ length: Math.min(40, ips.length) }, async () => {
    while (cursor < ips.length) {
      const ip = ips[cursor++];
      const result = await probe(ip);
      if (result) found.push(result);
    }
  }));
  const arp = await arpDevices(subnets);
  const devicesByIp = new Map(arp.map(device => [device.ip, { ...device, status: null, realm: '', solis: false }]));
  for (const device of found) devicesByIp.set(device.ip, { ...device, mac: devicesByIp.get(device.ip)?.mac || null });
  const devices = [...devicesByIp.values()];
  devices.sort((a, b) => Number(b.solis) - Number(a.solis) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return { subnets, devices };
}
