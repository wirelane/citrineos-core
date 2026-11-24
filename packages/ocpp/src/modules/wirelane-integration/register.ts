// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0

import { asClass, asFunction, type AwilixContainer, type Resolver } from 'awilix';
import {
  type AbstractHandler,
  type BuiltEndpoint,
  buildEndpoints,
  buildHandlers,
  type EndpointClass,
  type EndpointResolverCradle,
  type HandlerClass,
  type HandlerResolverCradle,
} from '@citrineos/base';
import {
  AuthorizeRequestOcpp16Handler,
  AuthorizeRequestOcpp201Handler,
  AuthorizeRequestOcpp21Handler,
} from '@handlers/index.js';
import { ActiveTransactionEndpoint } from './active-transaction-endpoint.js';
import { WirelaneAuthorizeRequestOcpp201Handler } from './handlers/wirelane-authorize-request-ocpp-201-handler.js';
import { WirelaneBootNotificationRequestOcpp16Handler } from './handlers/wirelane-boot-notification-request-ocpp-16-handler.js';
import { WirelaneBootNotificationRequestOcpp2Handler } from './handlers/wirelane-boot-notification-request-ocpp-2-handler.js';
import { WirelaneIntegrationModule } from './module.js';
import { StationDiscoveryNotifier } from './station-discovery-notifier.js';
import { WirelaneApi } from './wirelane-api.js';
import { WirelaneAuthorizationClient } from './wirelane-authorization-client.js';
import { WirelaneTransactionService } from './wirelane-transaction-service.js';
import { WirelaneWebhookDispatcher } from './wirelane-webhook-dispatcher.js';

/**
 * The handlers of the Wirelane module. It answers Authorize for every protocol instead of
 * EVDriver: 2.0.1 with {@link WirelaneAuthorizeRequestOcpp201Handler}, 1.6 and 2.1 with the
 * upstream handlers unchanged.
 */
export const WIRELANE_HANDLERS = [
  WirelaneBootNotificationRequestOcpp16Handler,
  WirelaneBootNotificationRequestOcpp2Handler,
  AuthorizeRequestOcpp16Handler,
  WirelaneAuthorizeRequestOcpp201Handler,
  AuthorizeRequestOcpp21Handler,
] satisfies ReadonlyArray<HandlerClass>;

/** The upstream Authorize handlers removed from EVDriver's handler list. */
const EVDRIVER_AUTHORIZE_HANDLERS = [
  AuthorizeRequestOcpp16Handler,
  AuthorizeRequestOcpp201Handler,
  AuthorizeRequestOcpp21Handler,
] satisfies ReadonlyArray<HandlerClass>;

export const WIRELANE_ENDPOINTS = [
  ActiveTransactionEndpoint,
] satisfies ReadonlyArray<EndpointClass>;

/**
 * Registers the Wirelane module, its services and API, and replaces three upstream
 * registrations. Must run after `buildContainer()` (`WirelaneCitrineOSServer`), so the later
 * registration of a token wins:
 *
 * - `transactionService` → {@link WirelaneTransactionService}
 * - `webhookDispatcher` → {@link WirelaneWebhookDispatcher}
 * - `evDriverHandlers` → the upstream list without the Authorize handlers, so Authorize is
 *   answered by the Wirelane module alone
 */
export function registerWirelaneServices(container: AwilixContainer): void {
  const upstreamEvDriverHandlers = container.registrations.evDriverHandlers as
    | Resolver<AbstractHandler[]>
    | undefined;
  if (!upstreamEvDriverHandlers) {
    throw new Error('registerWirelaneServices: evDriverHandlers is not registered');
  }

  container.register({
    stationDiscoveryNotifier: asClass(StationDiscoveryNotifier).scoped(),
    wirelaneAuthorizationClient: asClass(WirelaneAuthorizationClient).scoped(),
    transactionService: asClass(WirelaneTransactionService).scoped(),
    webhookDispatcher: asClass(WirelaneWebhookDispatcher).singleton(),
    wirelaneHandlers: asFunction((cradle: HandlerResolverCradle): AbstractHandler[] =>
      buildHandlers(cradle.moduleScope, WIRELANE_HANDLERS),
    ).scoped(),
    upstreamEvDriverHandlers,
    evDriverHandlers: asFunction(
      (cradle: { upstreamEvDriverHandlers: AbstractHandler[] }): AbstractHandler[] =>
        withoutAuthorizeHandlers(cradle.upstreamEvDriverHandlers),
    ).scoped(),
    wirelaneEndpoints: asFunction((cradle: EndpointResolverCradle): BuiltEndpoint[] =>
      buildEndpoints(cradle.moduleScope, WIRELANE_ENDPOINTS),
    ).scoped(),
    wirelaneApi: asClass(WirelaneApi).scoped(),
    wirelaneIntegrationModule: asClass(WirelaneIntegrationModule).scoped(),
  });
}

function withoutAuthorizeHandlers(handlers: AbstractHandler[]): AbstractHandler[] {
  const remaining = handlers.filter(
    (handler) =>
      !EVDRIVER_AUTHORIZE_HANDLERS.some((handlerClass) => handler instanceof handlerClass),
  );
  // Fails the start when upstream changes EVDriver's Authorize handlers.
  if (handlers.length - remaining.length !== EVDRIVER_AUTHORIZE_HANDLERS.length) {
    throw new Error(
      `EVDriver's handler list no longer contains exactly the ${EVDRIVER_AUTHORIZE_HANDLERS.length} ` +
        'upstream Authorize handlers the Wirelane module takes over.',
    );
  }
  return remaining;
}
