import { discoverS3 } from './discovery.ts';
import { readS3 } from './s3.ts';
import type { S3Config, Sample } from './types.ts';

interface SavedCollector extends S3Config {
  s3Mac: string;
}

type RecoveryDeps = {
  discover: typeof discoverS3;
  read: typeof readS3;
};

// Discovery identifies Solis before the saved credential is sent to a new IP.
export async function recoverS3(
  config: SavedCollector,
  expectedSerial: string | null,
  deps: RecoveryDeps = { discover: discoverS3, read: readS3 },
): Promise<{ ip: string; mac: string; sample: Sample } | null> {
  const { devices } = await deps.discover();
  const candidates = devices.filter(device => device.solis && device.ip !== config.s3Ip);
  const sameMac = config.s3Mac
    ? candidates.filter(device => device.mac?.toLowerCase() === config.s3Mac.toLowerCase())
    : [];
  // Without a MAC match, only one Solis with an unknown MAC is unambiguous.
  const selected = sameMac.length ? sameMac : candidates.length === 1 && (!config.s3Mac || !candidates[0].mac)
    ? candidates : [];
  for (const device of selected) {
    try {
      const sample = await deps.read({ ...config, s3Ip: device.ip });
      if (expectedSerial && sample.sn !== expectedSerial) continue;
      return { ip: device.ip, mac: device.mac || config.s3Mac, sample };
    } catch { /* Try the next identified candidate on this scan. */ }
  }
  return null;
}
