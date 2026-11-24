// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asFunction, asValue, type AwilixContainer } from 'awilix';
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
  ClearCacheResponseOcpp2Handler,
} from '@handlers/index.js';
import { registerWirelaneServices } from '@modules/wirelane-integration/register.js';
import { WirelaneIntegrationModule } from '@modules/wirelane-integration/module.js';
import { WirelaneAuthorizeRequestOcpp201Handler } from '@modules/wirelane-integration/handlers/wirelane-authorize-request-ocpp-201-handler.js';
import { createTestContainer, makeMockOcppSender } from '@test/test-container.js';

const config = {
  wirelane: {
    ocppAdapterBaseUrl: 'http://ocpp-adapter.internal',
    remoteAuthorization: { enabled: true, timeoutMs: 1000 },
  },
} as unknown as SystemConfig;

/** A stand-in instance of a handler class, enough for the `instanceof` filter. */
function aHandler(handlerClass: abstract new (...args: never[]) => AbstractHandler) {
  return Object.create(handlerClass.prototype) as AbstractHandler;
}

describe('registerWirelaneServices', () => {
  let container: AwilixContainer;
  let fetch: ReturnType<typeof vi.fn>;

  function givenEvDriverHandlers(handlers: AbstractHandler[]) {
    container.register({ evDriverHandlers: asFunction(() => handlers).scoped() });
  }

  beforeEach(() => {
    container = createTestContainer().container;
    container.register({
      config: asValue(config),
      authorizationRepository: asValue({ readOnlyOneByQuerystring: vi.fn() }),
      variableAttributeRepository: asValue({ readAllByQuerystring: vi.fn() }),
      tariffRepository: asValue({}),
      authorizers: asValue([]),
      certificateAuthorityService: asValue({}),
      subscriptionRepository: asValue({}),
      ocppMessageRepository: asValue({}),
      cache: asValue({}),
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

  it('removes the three upstream Authorize handlers from EVDriver and keeps the others', () => {
    const clearCache = aHandler(ClearCacheResponseOcpp2Handler);
    givenEvDriverHandlers([
      aHandler(AuthorizeRequestOcpp16Handler),
      aHandler(AuthorizeRequestOcpp201Handler),
      aHandler(AuthorizeRequestOcpp21Handler),
      clearCache,
    ]);
    registerWirelaneServices(container);

    expect(container.createScope().resolve('evDriverHandlers')).toEqual([clearCache]);
  });

  it('fails when EVDriver no longer has exactly the three upstream Authorize handlers', () => {
    givenEvDriverHandlers([
      aHandler(AuthorizeRequestOcpp16Handler),
      aHandler(AuthorizeRequestOcpp201Handler),
    ]);
    registerWirelaneServices(container);

    expect(() => container.createScope().resolve('evDriverHandlers')).toThrow(
      /no longer contains exactly the 3 upstream Authorize handlers/,
    );
  });

  it('fails without an EVDriver handler registration to replace', () => {
    expect(() => registerWirelaneServices(container)).toThrow(/evDriverHandlers/);
  });

  it('builds a module that routes 2.0.1 Authorize to the Wirelane handler', async () => {
    givenEvDriverHandlers([]);
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
