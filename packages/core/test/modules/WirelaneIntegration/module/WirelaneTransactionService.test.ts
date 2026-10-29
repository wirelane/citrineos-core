// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@citrineos/base';
import { OCPP2_0_1 } from '@citrineos/types';
import { WirelaneTransactionService } from '@modules/WirelaneIntegration/src/module/WirelaneTransactionService.js';
import { createTestContainer, getTestInstance } from '@test/testContainer.js';
import { aMessageContext } from '../../Transactions/providers/MessageContextProvider.js';
import { aTransactionEventRequest } from '../../Transactions/providers/TransactionProvider.js';

describe('WirelaneTransactionService', () => {
  const { container } = createTestContainer();
  let service: WirelaneTransactionService;
  let authorizationRepository: { readAllByQuerystring: ReturnType<typeof vi.fn> };
  let wirelaneAuthorizationClient: {
    isEnabled: ReturnType<typeof vi.fn>;
    authorize: ReturnType<typeof vi.fn>;
  };

  const messageContext = aMessageContext((context) => {
    context.ocppConnectionName = 'TEST001';
  });

  function startedEvent(idToken: OCPP2_0_1.IdTokenType): OCPP2_0_1.TransactionEventRequest {
    return aTransactionEventRequest((event) => {
      event.eventType = OCPP2_0_1.TransactionEventEnumType.Started;
      event.transactionInfo = { transactionId: 'tx-42' };
      event.evse = { id: 2, connectorId: 1 };
      event.idToken = idToken;
    });
  }

  beforeEach(() => {
    // The token is unknown to CitrineOS: upstream answers Unknown.
    authorizationRepository = { readAllByQuerystring: vi.fn().mockResolvedValue([]) };
    wirelaneAuthorizationClient = {
      isEnabled: vi.fn().mockReturnValue(true),
      authorize: vi.fn().mockResolvedValue({ status: 'Accepted' }),
    };
    service = getTestInstance(container, WirelaneTransactionService, {
      transactionEventRepository: {} as any,
      authorizationRepository: authorizationRepository as any,
      locationRepository: {} as any,
      reservationRepository: {} as any,
      ocppMessageRepository: {} as any,
      realTimeAuthorizer: { authorize: vi.fn() } as any,
      authorizers: [],
      wirelaneAuthorizationClient: wirelaneAuthorizationClient as any,
    });
  });

  it('asks ocpp-adapter with transaction, EVSE and connector and returns its decision', async () => {
    const response = await service.authorizeOcpp201IdToken(
      DEFAULT_TENANT_ID,
      startedEvent({ idToken: '04A2B3C4', type: OCPP2_0_1.IdTokenEnumType.ISO14443 }),
      messageContext,
    );

    expect(wirelaneAuthorizationClient.authorize).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      stationId: 'TEST001',
      protocol: 'ocpp2.0.1',
      trigger: 'TransactionEvent',
      idToken: '04A2B3C4',
      idTokenType: 'ISO14443',
      evseId: 2,
      connectorId: 1,
      transactionId: 'tx-42',
      eventType: 'Started',
    });
    expect(response).toEqual({
      idTokenInfo: {
        status: 'Accepted',
        groupIdToken: { idToken: '04A2B3C4', type: 'ISO14443' },
      },
    });
    expect(authorizationRepository.readAllByQuerystring).not.toHaveBeenCalled();
  });

  it('returns Invalid with cacheExpiryDateTime as decided by ocpp-adapter', async () => {
    wirelaneAuthorizationClient.authorize.mockResolvedValueOnce({
      status: 'Invalid',
      cacheExpiryDateTime: '2026-10-29T12:00:00Z',
    });

    const response = await service.authorizeOcpp201IdToken(
      DEFAULT_TENANT_ID,
      startedEvent({ idToken: '04A2B3C4', type: OCPP2_0_1.IdTokenEnumType.ISO14443 }),
      messageContext,
    );

    expect(response).toEqual({
      idTokenInfo: { status: 'Invalid', cacheExpiryDateTime: '2026-10-29T12:00:00Z' },
    });
  });

  it('groups an accepted Central token by itself, like any accepted token', async () => {
    const response = await service.authorizeOcpp201IdToken(
      DEFAULT_TENANT_ID,
      startedEvent({ idToken: 'a1b2c3d4-remote-start', type: OCPP2_0_1.IdTokenEnumType.Central }),
      messageContext,
    );

    expect(response).toEqual({
      idTokenInfo: {
        status: 'Accepted',
        groupIdToken: { idToken: 'a1b2c3d4-remote-start', type: 'Central' },
      },
    });
  });

  it('accepts NoAuthorization without asking ocpp-adapter', async () => {
    const response = await service.authorizeOcpp201IdToken(
      DEFAULT_TENANT_ID,
      startedEvent({ idToken: '', type: OCPP2_0_1.IdTokenEnumType.NoAuthorization }),
      messageContext,
    );

    expect(wirelaneAuthorizationClient.authorize).not.toHaveBeenCalled();
    expect(response).toEqual({ idTokenInfo: { status: 'Accepted' } });
  });

  it('keeps the upstream behaviour when remote authorization is disabled', async () => {
    wirelaneAuthorizationClient.isEnabled.mockReturnValue(false);

    const response = await service.authorizeOcpp201IdToken(
      DEFAULT_TENANT_ID,
      startedEvent({ idToken: '04A2B3C4', type: OCPP2_0_1.IdTokenEnumType.ISO14443 }),
      messageContext,
    );

    expect(wirelaneAuthorizationClient.authorize).not.toHaveBeenCalled();
    expect(authorizationRepository.readAllByQuerystring).toHaveBeenCalled();
    expect(response).toEqual({ idTokenInfo: { status: 'Unknown' } });
  });
});
