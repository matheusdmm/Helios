import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { probeS3 } from '../lib/discovery.ts';

test('discovery recognizes a Solis auth challenge and always finishes a stalled probe', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response('', {
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="solis"' },
    })) as unknown as typeof fetch;
    const identified = await probeS3('192.168.1.10');
    assert.equal(identified?.status, 401);
    assert.equal(identified?.solis, true);

    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const stalled = await probeS3('192.168.1.11');
    assert.equal(stalled, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
