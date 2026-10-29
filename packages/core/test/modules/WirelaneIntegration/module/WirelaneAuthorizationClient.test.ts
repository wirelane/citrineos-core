// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemConfig } from '@citrineos/types';
import {
  maskIdToken,
  WirelaneAuthorizationClient,
  type WirelaneAuthorizationRequest,
} from '@modules/WirelaneIntegration/src/module/WirelaneAuthorizationClient.js';
import { createTestContainer, type MockLogger } from '@test/testContainer.js';

describe('WirelaneAuthorizationClient', () => {
  const ADAPTER_BASE_URL = 'http://ocpp-adapter.internal';
  const fetch = vi.fn();
  let logger: MockLogger;

  const REQUEST: WirelaneAuthorizationRequest = {
    tenantId: 1,
    stationId: 'TEST001',
    protocol: 'ocpp2.0.1',
    trigger: 'TransactionEvent',
    idToken: '04A2B3C4D5E6F7',
    idTokenType: 'ISO14443',
    evseId: 1,
    connectorId: 2,
    transactionId: 'tx-1',
    eventType: 'Started',
    timestamp: '2026-10-29T08:15:30.250+01:00',
  };

  function jsonResponse(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  }

  beforeEach(() => {
    global.fetch = fetch;
  });

  afterEach(() => {
    fetch.mockReset();
  });

  function createClient(wirelane?: Record<string, unknown>): WirelaneAuthorizationClient {
    const config = {
      modules: {
        wirelane: wirelane ?? {
          ocppAdapterBaseUrl: `${ADAPTER_BASE_URL}/`,
          remoteAuthorization: { enabled: true, timeoutMs: 1000 },
        },
      },
    } as unknown as SystemConfig;
    const container = createTestContainer();
    logger = container.logger;
    return new WirelaneAuthorizationClient({ config: config as any, logger: logger as any });
  }

  it('POSTs the request with csms to /internal/authorizations and returns the decision', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(200, { status: 'Accepted' }));

    const decision = await createClient().authorize(REQUEST);

    expect(decision).toEqual({ status: 'Accepted' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://ocpp-adapter.internal/internal/authorizations');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      csms: 'citrineos',
      tenantId: 1,
      stationId: 'TEST001',
      protocol: 'ocpp2.0.1',
      trigger: 'TransactionEvent',
      idToken: '04A2B3C4D5E6F7',
      idTokenType: 'ISO14443',
      evseId: 1,
      connectorId: 2,
      transactionId: 'tx-1',
      eventType: 'Started',
      timestamp: '2026-10-29T08:15:30.250+01:00',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends no timestamp field for an Authorize request', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(200, { status: 'Accepted' }));

    await createClient().authorize({
      tenantId: 1,
      stationId: 'TEST001',
      protocol: 'ocpp2.0.1',
      trigger: 'Authorize',
      idToken: '04A2B3C4',
      idTokenType: 'ISO14443',
    });

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      csms: 'citrineos',
      tenantId: 1,
      stationId: 'TEST001',
      protocol: 'ocpp2.0.1',
      trigger: 'Authorize',
      idToken: '04A2B3C4',
      idTokenType: 'ISO14443',
    });
  });

  it('passes cacheExpiryDateTime through', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse(200, { status: 'Accepted', cacheExpiryDateTime: '2026-10-29T12:00:00Z' }),
    );

    await expect(createClient().authorize(REQUEST)).resolves.toEqual({
      status: 'Accepted',
      cacheExpiryDateTime: '2026-10-29T12:00:00Z',
    });
  });

  it('passes an RFC 3339 cacheExpiryDateTime with a numeric offset through', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse(200, { status: 'Accepted', cacheExpiryDateTime: '2026-10-29T12:00:00.5+01:00' }),
    );

    await expect(createClient().authorize(REQUEST)).resolves.toEqual({
      status: 'Accepted',
      cacheExpiryDateTime: '2026-10-29T12:00:00.5+01:00',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    '2026-10-29 12:00:00',
    '2026-10-29T12:00:00',
    '2026-10-29',
    '2026-13-45T25:00:00Z',
    'soon',
    '',
  ])(
    'drops the invalid cacheExpiryDateTime %j but keeps the status',
    async (cacheExpiryDateTime) => {
      fetch.mockResolvedValueOnce(jsonResponse(200, { status: 'Accepted', cacheExpiryDateTime }));

      await expect(createClient().authorize(REQUEST)).resolves.toEqual({ status: 'Accepted' });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    },
  );

  it('truncates a long adapter error body in the log', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('unused')),
      text: () => Promise.resolve('x'.repeat(10_000)),
    });

    await expect(createClient().authorize(REQUEST)).resolves.toEqual({ status: 'Invalid' });
    const { errorText } = logger.error.mock.calls[0][1];
    expect(errorText.length).toBeLessThan(600);
    expect(errorText).toContain('10000 characters');
  });

  it('returns Invalid from the adapter as Invalid', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(200, { status: 'Invalid' }));

    await expect(createClient().authorize(REQUEST)).resolves.toEqual({ status: 'Invalid' });
  });

  it('returns Invalid when the request times out', async () => {
    fetch.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const client = createClient({
      ocppAdapterBaseUrl: ADAPTER_BASE_URL,
      remoteAuthorization: { enabled: true, timeoutMs: 20 },
    });

    await expect(client.authorize(REQUEST)).resolves.toEqual({ status: 'Invalid' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns Invalid on a network error', async () => {
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(createClient().authorize(REQUEST)).resolves.toEqual({ status: 'Invalid' });
    expect(logger.error).toHaveBeenCalled();
  });

  it.each([400, 404, 500])('returns Invalid on HTTP %i', async (status) => {
    fetch.mockResolvedValueOnce(jsonResponse(status, { status: 'Accepted' }));

    await expect(createClient().authorize(REQUEST)).resolves.toEqual({ status: 'Invalid' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns Invalid when the body is not JSON', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      text: () => Promise.resolve('<html>'),
    });

    await expect(createClient().authorize(REQUEST)).resolves.toEqual({ status: 'Invalid' });
    expect(logger.error).toHaveBeenCalled();
  });

  it.each([{ status: 'Blocked' }, { status: 'accepted' }, {}, null, 'Accepted'])(
    'returns Invalid for the unknown body %j',
    async (body) => {
      fetch.mockResolvedValueOnce(jsonResponse(200, body));

      await expect(createClient().authorize(REQUEST)).resolves.toEqual({ status: 'Invalid' });
      expect(logger.error).toHaveBeenCalled();
    },
  );

  it('returns Invalid without a request when ocppAdapterBaseUrl is not set', async () => {
    const client = createClient({ remoteAuthorization: { enabled: true } });

    await expect(client.authorize(REQUEST)).resolves.toEqual({ status: 'Invalid' });
    expect(fetch).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('never logs the plain id token', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(500, {}));

    await createClient().authorize(REQUEST);

    const logged = JSON.stringify([...logger.error.mock.calls, ...logger.info.mock.calls]);
    expect(logged).not.toContain('04A2B3C4D5E6F7');
    expect(logged).toContain('04**********F7');
  });

  it('reports the remoteAuthorization flag, defaulting to disabled', () => {
    expect(createClient().isEnabled()).toBe(true);
    expect(
      createClient({
        ocppAdapterBaseUrl: ADAPTER_BASE_URL,
        remoteAuthorization: { enabled: false },
      }).isEnabled(),
    ).toBe(false);
    expect(createClient({ ocppAdapterBaseUrl: ADAPTER_BASE_URL }).isEnabled()).toBe(false);
  });

  it('masks id tokens', () => {
    expect(maskIdToken('04A2B3C4')).toBe('04****C4');
    expect(maskIdToken('ABCD')).toBe('****');
    expect(maskIdToken('')).toBe('');
  });
});
