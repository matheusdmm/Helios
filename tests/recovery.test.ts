import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { recoverS3 } from '../lib/recovery.ts';
import type { Sample } from '../lib/types.ts';

const config = { s3Ip: '192.168.1.10', s3Mac: 'aa:bb:cc:dd:ee:ff', s3User: 'admin', s3Password: 'saved-secret' };
const sample = { sn: 'EXPECTED' } as Sample;

test('reconnects at a new IP using the saved credential and matching MAC', async () => {
  const attempts: string[] = [];
  const result = await recoverS3(config, sample.sn, {
    discover: async () => ({ subnets: [], devices: [
      { ip: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:ff', status: 401, realm: 'solis', solis: true },
      { ip: '192.168.1.30', mac: '12:34:56:78:90:ab', status: 401, realm: 'solis', solis: true },
    ] }),
    read: async candidate => {
      attempts.push(candidate.s3Ip);
      assert.equal(candidate.s3Password, 'saved-secret');
      return sample;
    },
  });
  assert.deepEqual(attempts, ['192.168.1.20']);
  assert.equal(result?.ip, '192.168.1.20');
});

test('does not send the password to unidentified or mismatched devices', async () => {
  let reads = 0;
  const result = await recoverS3(config, sample.sn, {
    discover: async () => ({ subnets: [], devices: [
      { ip: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:ff', status: 200, realm: '', solis: false },
      { ip: '192.168.1.30', mac: '12:34:56:78:90:ab', status: 401, realm: 'solis', solis: true },
    ] }),
    read: async () => { reads++; return sample; },
  });
  assert.equal(result, null);
  assert.equal(reads, 0);
});

test('rejects a different inverter serial after authentication', async () => {
  const result = await recoverS3(config, sample.sn, {
    discover: async () => ({ subnets: [], devices: [
      { ip: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:ff', status: 401, realm: 'solis', solis: true },
    ] }),
    read: async () => ({ ...sample, sn: 'OTHER' }),
  });
  assert.equal(result, null);
});

test('finds a single Solis when only a password is configured', async () => {
  const result = await recoverS3({ ...config, s3Ip: '', s3Mac: '' }, null, {
    discover: async () => ({ subnets: [], devices: [
      { ip: '192.168.1.20', mac: null, status: 401, realm: 'solis', solis: true },
    ] }),
    read: async () => sample,
  });
  assert.equal(result?.ip, '192.168.1.20');
});
