// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asValue, type AwilixContainer } from 'awilix';
import { type AbstractHandler, DEFAULT_TENANT_ID, type IMessage } from '@citrineos/base';
import {
  EventGroup,
  MessageOrigin,
  MessageState,
  OCPP_CallAction,
  OCPPVersion,
  type SystemConfig,
} from '@citrineos/types';
import {
  AuthorizeRequestOcpp16Handler,
  AuthorizeRequestOcpp201Handler,
  AuthorizeRequestOcpp21Handler,
  WirelaneAuthorizeRequestOcpp201Handler,
  WirelaneBootNotificationRequestOcpp16Handler,
  WirelaneBootNotificationRequestOcpp2Handler,
} from '@handlers/index.js';
import {
  registerWirelaneServices,
  selectWirelaneHandlerClasses,
} from '@modules/WirelaneIntegration/src/register.js';
import { WirelaneIntegrationModule } from '@modules/WirelaneIntegration/src/module/module.js';
import { WirelaneTransactionService } from '@modules/WirelaneIntegration/src/module/WirelaneTransactionService.js';
import { registerTransactionsServices } from '@modules/Transactions/src/register.js';
import { TransactionService } from '@modules/Transactions/src/module/TransactionService.js';
import { createTestContainer, makeMockOcppSender, type MockLogger } from '@test/testContainer.js';

function makeConfig({
  evdriverExcludesAuthorize,
  remoteAuthorizationEnabled,
}: {
  evdriverExcludesAuthorize: boolean;
  remoteAuthorizationEnabled: boolean;
}): SystemConfig {
  return {
    maxCachingSeconds: 30,
    modules: {
      evdriver: {
        endpointPrefix: '/evdriver',
        requests: [],
        responses: [],
        ...(evdriverExcludesAuthorize ? { excludedRequests: [OCPP_CallAction.Authorize] } : {}),
      },
      wirelane: {
        endpointPrefix: '/wirelane',
        requests: [],
        responses: [],
        ocppAdapterBaseUrl: 'http://ocpp-adapter.internal',
        ocppAdapterWebhookUrl: 'http://ocpp-adapter.internal/webhook/citrineos',
        remoteAuthorization: { enabled: remoteAuthorizationEnabled, timeoutMs: 1000 },
      },
    },
  } as unknown as SystemConfig;
}

describe('selectWirelaneHandlerClasses', () => {
  let logger: MockLogger;

  beforeEach(() => {
    logger = createTestContainer().logger;
  });

  it('takes over Authorize for 1.6, 2.0.1 and 2.1 when EVDriver excludes Authorize', () => {
    const handlerClasses = selectWirelaneHandlerClasses(
      makeConfig({ evdriverExcludesAuthorize: true, remoteAuthorizationEnabled: true }),
      logger as any,
    );

    expect(handlerClasses).toEqual([
      WirelaneBootNotificationRequestOcpp16Handler,
      WirelaneBootNotificationRequestOcpp2Handler,
      AuthorizeRequestOcpp16Handler,
      WirelaneAuthorizeRequestOcpp201Handler,
      AuthorizeRequestOcpp21Handler,
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps the Authorize handlers out when EVDriver still answers Authorize, and warns', () => {
    const handlerClasses = selectWirelaneHandlerClasses(
      makeConfig({ evdriverExcludesAuthorize: false, remoteAuthorizationEnabled: true }),
      logger as any,
    );

    expect(handlerClasses).toEqual([
      WirelaneBootNotificationRequestOcpp16Handler,
      WirelaneBootNotificationRequestOcpp2Handler,
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn without the exclusion when remote authorization is disabled', () => {
    selectWirelaneHandlerClasses(
      makeConfig({ evdriverExcludesAuthorize: false, remoteAuthorizationEnabled: false }),
      logger as any,
    );

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('registerWirelaneServices', () => {
  let container: AwilixContainer;
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = createTestContainer().container;
    container.register({
      config: asValue(
        makeConfig({ evdriverExcludesAuthorize: true, remoteAuthorizationEnabled: true }),
      ),
      transactionEventRepository: asValue({}),
      authorizationRepository: asValue({ readOnlyOneByQuerystring: vi.fn() }),
      locationRepository: asValue({}),
      reservationRepository: asValue({}),
      ocppMessageRepository: asValue({}),
      deviceModelRepository: asValue({}),
      tariffRepository: asValue({}),
      realTimeAuthorizer: asValue({ authorize: vi.fn() }),
      authorizers: asValue([]),
      certificateAuthorityService: asValue({}),
      webhookDispatcher: asValue({ reloadSubscriptions: vi.fn() }),
      ocppSender: asValue(makeMockOcppSender()),
    });
    fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'Accepted' }),
      text: () => Promise.resolve(''),
    });
    global.fetch = fetch;
  });

  it('replaces transactionService when registered after registerTransactionsServices', () => {
    // Same order as registerModuleServices in apps/ocpp-server/src/container.ts.
    registerTransactionsServices(container);
    registerWirelaneServices(container);

    const transactionService = container.createScope().resolve('transactionService');

    expect(transactionService).toBeInstanceOf(WirelaneTransactionService);
  });

  it('the Transactions module alone resolves the upstream TransactionService', () => {
    // Shows what the override in the test above changes.
    registerTransactionsServices(container);

    const transactionService = container.createScope().resolve('transactionService');

    expect(transactionService).toBeInstanceOf(TransactionService);
    expect(transactionService).not.toBeInstanceOf(WirelaneTransactionService);
  });

  it('builds a module that routes 2.0.1 Authorize to the Wirelane handler', async () => {
    registerWirelaneServices(container);
    const scope = container.createScope();
    scope.register({ moduleScope: asValue(scope) });
    const handlers = scope.resolve<AbstractHandler[]>('wirelaneHandlers');

    // Throws if two different handler instances claim the same protocol/action.
    const module = new WirelaneIntegrationModule({
      config: scope.resolve('config'),
      cache: {} as any,
      sender: {} as any,
      handler: {} as any,
      logger: scope.resolve('logger'),
      ocppValidator: {
        sanitizeOCPPPayload: (payload: unknown) => payload,
        validateOCPPRequest: () => ({ isValid: true }),
      } as any,
      ocppSender: scope.resolve('ocppSender'),
      wirelaneHandlers: handlers,
    });

    expect(
      handlers.some((handler) => handler instanceof WirelaneAuthorizeRequestOcpp201Handler),
    ).toBe(true);
    expect(handlers.some((handler) => handler.constructor === AuthorizeRequestOcpp201Handler)).toBe(
      false,
    );

    await module.handle({
      context: {
        tenantId: DEFAULT_TENANT_ID,
        ocppConnectionName: 'TEST001',
        correlationId: 'corr-001',
        timestamp: new Date().toISOString(),
      },
      payload: { idToken: { idToken: '04A2B3C4', type: 'ISO14443' } },
      origin: MessageOrigin.ChargingStationManagementSystem,
      eventGroup: EventGroup.Wirelane,
      action: OCPP_CallAction.Authorize,
      state: MessageState.Request,
      protocol: OCPPVersion.OCPP2_0_1,
    } as unknown as IMessage<never>);

    expect(fetch).toHaveBeenCalledWith(
      'http://ocpp-adapter.internal/internal/authorizations',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
