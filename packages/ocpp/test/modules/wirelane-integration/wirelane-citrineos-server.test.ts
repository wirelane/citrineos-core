// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asValue, type AwilixContainer } from 'awilix';
import fastify from 'fastify';
import {
  type AbstractHandler,
  type AbstractModule,
  ConfigLoader,
  type IFileStorage,
  MemoryCache,
  OCPPValidator,
} from '@citrineos/base';
import { EventGroup, OCPP_CallAction } from '@citrineos/types';
import { buildContainer } from '@/server/container.js';
import {
  AuthorizeRequestOcpp16Handler,
  AuthorizeRequestOcpp201Handler,
  AuthorizeRequestOcpp21Handler,
} from '@handlers/index.js';
import { WirelaneAuthorizeRequestOcpp201Handler } from '@modules/wirelane-integration/handlers/wirelane-authorize-request-ocpp-201-handler.js';
import { WirelaneCitrineOSServer } from '@modules/wirelane-integration/wirelane-citrineos-server.js';
import { WirelaneTransactionService } from '@modules/wirelane-integration/wirelane-transaction-service.js';
import { WirelaneWebhookDispatcher } from '@modules/wirelane-integration/wirelane-webhook-dispatcher.js';
import { createTestContainer } from '@test/test-container.js';
import { aSystemConfig } from '@test/providers/system-config.js';

/** Exposes the container and specs the real server builds. */
class TestServer extends WirelaneCitrineOSServer {
  buildTestContainer(): AwilixContainer {
    const container = buildContainer(this._config, {
      logger: createTestContainer().logger,
      cache: new MemoryCache(),
      fileStorage: {} as IFileStorage,
      ocppValidator: new OCPPValidator(),
      server: fastify(),
    });
    this.registerAdditionalServices(container);
    return container;
  }

  get testModuleSpecs() {
    return this.moduleSpecs;
  }

  get testApiSpecs() {
    return this.apiSpecs;
  }
}

const AUTHORIZE_HANDLERS = [
  AuthorizeRequestOcpp16Handler,
  AuthorizeRequestOcpp201Handler,
  AuthorizeRequestOcpp21Handler,
];

function isAuthorizeHandler(handler: AbstractHandler): boolean {
  return AUTHORIZE_HANDLERS.some((handlerClass) => handler instanceof handlerClass);
}

describe('WirelaneCitrineOSServer', () => {
  // No certificate integrations: their clients read files on construction.
  const server = new TestServer('all', aSystemConfig({ integrations: {} }));
  let container: AwilixContainer;

  function resolveInModuleScope<T>(token: string): T {
    const scope = container.createScope();
    scope.register({ moduleScope: asValue(scope) });
    return scope.resolve<T>(token);
  }

  beforeAll(() => {
    container = server.buildTestContainer();
  });

  afterAll(async () => {
    container.resolve<WirelaneWebhookDispatcher>('webhookDispatcher').shutdown();
    await container.dispose();
  });

  it('starts the Wirelane module with the other modules', () => {
    expect(server.testModuleSpecs[EventGroup.Wirelane]).toEqual({
      moduleToken: 'wirelaneIntegrationModule',
    });
    expect(server.testModuleSpecs[EventGroup.EVDriver]).toEqual({ moduleToken: 'evDriverModule' });
  });

  it('starts the Wirelane API with the other APIs', () => {
    expect(server.testApiSpecs[EventGroup.Api]?.apiTokens).toEqual(
      expect.arrayContaining(['commandsApi', 'wirelaneApi']),
    );
  });

  it('EVDriver has no Authorize handler', () => {
    const handlers = resolveInModuleScope<AbstractHandler[]>('evDriverHandlers');

    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers.filter(isAuthorizeHandler)).toEqual([]);
  });

  it('the Wirelane module answers Authorize for 1.6, 2.0.1 (delegated) and 2.1', () => {
    const handlers = resolveInModuleScope<AbstractHandler[]>('wirelaneHandlers');

    expect(handlers.filter(isAuthorizeHandler).map((handler) => handler.constructor)).toEqual([
      AuthorizeRequestOcpp16Handler,
      WirelaneAuthorizeRequestOcpp201Handler,
      AuthorizeRequestOcpp21Handler,
    ]);
  });

  it('resolves transactionService to WirelaneTransactionService', () => {
    expect(resolveInModuleScope('transactionService')).toBeInstanceOf(WirelaneTransactionService);
  });

  it('resolves webhookDispatcher to WirelaneWebhookDispatcher', () => {
    expect(container.resolve('webhookDispatcher')).toBeInstanceOf(WirelaneWebhookDispatcher);
  });

  it('binds Authorize to the Wirelane request queue and not to the EVDriver one', async () => {
    const subscribedRequests = async (moduleToken: string): Promise<OCPP_CallAction[]> => {
      const subscribe = vi.fn().mockResolvedValue(true);
      const scope = container.createScope();
      scope.register({
        moduleScope: asValue(scope),
        handler: asValue({ subscribe }),
        sender: asValue({}),
      });
      await scope.resolve<AbstractModule>(moduleToken).initHandlers();
      const [identifier, actions] = subscribe.mock.calls[0];
      expect(identifier).toMatch(/_requests$/);
      return actions;
    };

    expect(await subscribedRequests('wirelaneIntegrationModule')).toEqual(
      expect.arrayContaining([OCPP_CallAction.Authorize, OCPP_CallAction.BootNotification]),
    );
    expect(await subscribedRequests('evDriverModule')).not.toContain(OCPP_CallAction.Authorize);
  });
});

describe('wirelane config', () => {
  let envSnapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    envSnapshot = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.toLowerCase().startsWith('citrineos')) {
        delete process.env[key];
      }
    }
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    return () => {
      process.env = envSnapshot;
      vi.restoreAllMocks();
    };
  });

  it('defaults to remote authorization on, with 18 s below the 20 s call length', async () => {
    const config = await ConfigLoader.loadConfig();

    expect(config.wirelane).toEqual({
      remoteAuthorization: { enabled: true, timeoutMs: 18000 },
    });
    expect(config.timeouts.maxCallLengthSeconds).toBe(20);
  });

  it('reads every key from CITRINEOS_WIRELANE_* variables', async () => {
    process.env.CITRINEOS_WIRELANE_OCPPADAPTERBASEURL = 'http://ocpp-adapter.internal';
    process.env.CITRINEOS_WIRELANE_OCPPADAPTERWEBHOOKURL =
      'http://ocpp-adapter.internal/webhook/citrineos';
    process.env.CITRINEOS_WIRELANE_REMOTEAUTHORIZATION_ENABLED = 'false';
    process.env.CITRINEOS_WIRELANE_REMOTEAUTHORIZATION_TIMEOUTMS = '12000';

    const config = await ConfigLoader.loadConfig();

    expect(config.wirelane).toEqual({
      ocppAdapterBaseUrl: 'http://ocpp-adapter.internal',
      ocppAdapterWebhookUrl: 'http://ocpp-adapter.internal/webhook/citrineos',
      remoteAuthorization: { enabled: false, timeoutMs: 12000 },
    });
  });
});
