// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_TENANT_ID } from '@citrineos/base';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveTransactionEndpoint } from '@modules/wirelane-integration/active-transaction-endpoint.js';
import { WIRELANE_ENDPOINT_PREFIX } from '@modules/wirelane-integration/wirelane-api.js';
import { createTestContainer, getTestInstance } from '@test/test-container.js';
import { mountEndpoint, type MountedEndpoint } from '@test/providers/endpoint-harness.js';

const URL = '/wirelane/transactions/activeTransaction';

describe('ActiveTransactionEndpoint', () => {
  const { container } = createTestContainer();
  let getActiveTransactionByStationIdAndEvseId: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getActiveTransactionByStationIdAndEvseId = vi.fn();
  });

  const mount = (): Promise<MountedEndpoint> => {
    const endpoint = getTestInstance(container, ActiveTransactionEndpoint, {
      transactionRepository: { getActiveTransactionByStationIdAndEvseId } as any,
    });
    return mountEndpoint(endpoint, ActiveTransactionEndpoint.route, WIRELANE_ENDPOINT_PREFIX);
  };

  it('answers the transactionId of the active transaction on the EVSE', async () => {
    getActiveTransactionByStationIdAndEvseId.mockResolvedValue({
      id: 17,
      transactionId: 'tx-42',
      isActive: true,
    });
    const mounted = await mount();

    const response = await mounted.server.inject({
      method: 'GET',
      url: `${URL}?ocppConnectionName=CS001&evseId=2&tenantId=7`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ transactionId: 'tx-42' });
    expect(getActiveTransactionByStationIdAndEvseId).toHaveBeenCalledWith(7, 'CS001', 2);
  });

  it('uses the default tenant when none is given', async () => {
    getActiveTransactionByStationIdAndEvseId.mockResolvedValue({ transactionId: 'tx-42' });
    const mounted = await mount();

    await mounted.server.inject({ method: 'GET', url: `${URL}?ocppConnectionName=CS001&evseId=2` });

    expect(getActiveTransactionByStationIdAndEvseId).toHaveBeenCalledWith(
      DEFAULT_TENANT_ID,
      'CS001',
      2,
    );
  });

  it('answers 404 without an error log when the EVSE has no active transaction', async () => {
    getActiveTransactionByStationIdAndEvseId.mockResolvedValue(undefined);
    const mounted = await mount();

    const response = await mounted.server.inject({
      method: 'GET',
      url: `${URL}?ocppConnectionName=CS001&evseId=2`,
    });

    expect(response.statusCode).toBe(404);
    expect(mounted.loggedErrors).toEqual([]);
  });

  it.each([
    ['the station', '?evseId=2'],
    ['the EVSE', '?ocppConnectionName=CS001'],
  ])('rejects a request without %s', async (_missing, query) => {
    const mounted = await mount();

    const response = await mounted.server.inject({ method: 'GET', url: `${URL}${query}` });

    expect(response.statusCode).toBe(400);
    expect(getActiveTransactionByStationIdAndEvseId).not.toHaveBeenCalled();
  });
});
