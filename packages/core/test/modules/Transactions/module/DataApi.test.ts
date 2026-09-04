// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionsDataApi } from '@modules/Transactions/src/module/DataApi.js';
import { createTestContainer, getTestInstance } from '@test/testContainer.js';

// Prevent the AbstractModuleApi constructor from registering real routes against a fake server.
vi.spyOn(Reflect, 'getMetadata').mockReturnValue([]);

const TENANT_ID = 1;

function buildRequest(query: Record<string, unknown>): any {
  return { query: { tenantId: TENANT_ID, ...query } };
}

describe('TransactionsDataApi.getActiveTransactionByStationIdAndEvseId', () => {
  const { container } = createTestContainer();
  let dataApi: TransactionsDataApi;
  let mockTransactionEventRepository: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTransactionEventRepository = {
      getActiveTransactionByStationIdAndEvseId: vi.fn().mockResolvedValue({ id: 'txn-row-1' }),
    };

    dataApi = getTestInstance(container, TransactionsDataApi, {
      transactionsModule: {
        transactionEventRepository: mockTransactionEventRepository,
      } as any,
      server: { register: vi.fn() } as any,
    });
  });

  it('looks up the active transaction by station and evseId', async () => {
    const result = await dataApi.getActiveTransactionByStationIdAndEvseId(
      buildRequest({ ocppConnectionName: 'STATION-1', evseId: 2 }),
    );

    expect(mockTransactionEventRepository.getActiveTransactionByStationIdAndEvseId).toHaveBeenCalledWith(
      TENANT_ID,
      'STATION-1',
      2,
    );
    expect(result).toEqual({ id: 'txn-row-1' });
  });
});
