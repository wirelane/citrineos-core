// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0

import { asClass, asFunction, type AwilixContainer } from 'awilix';
import {
  type AbstractHandler,
  buildHandlers,
  type HandlerClass,
  type HandlerResolverCradle,
} from '@citrineos/base';
import { OCPP_CallAction, type SystemConfig } from '@citrineos/types';
import type { ILogObj, Logger } from 'tslog';
import { StationDiscoveryNotifier } from './module/StationDiscoveryNotifier.js';
import { WirelaneAuthorizationClient } from './module/WirelaneAuthorizationClient.js';
import { WirelaneTransactionService } from './module/WirelaneTransactionService.js';
import {
  AuthorizeRequestOcpp16Handler,
  AuthorizeRequestOcpp21Handler,
  WirelaneAuthorizeRequestOcpp201Handler,
  WirelaneBootNotificationRequestOcpp16Handler,
  WirelaneBootNotificationRequestOcpp2Handler,
} from '@handlers/index.js';

const WIRELANE_HANDLERS = [
  WirelaneBootNotificationRequestOcpp16Handler,
  WirelaneBootNotificationRequestOcpp2Handler,
] satisfies ReadonlyArray<HandlerClass>;

/**
 * Authorize handlers this module takes over from EVDriver. Only 2.0.1 is delegated to
 * ocpp-adapter; 1.6 and 2.1 stay the upstream handlers, they only move module because EVDriver's
 * `excludedRequests` drops Authorize for every protocol.
 */
const WIRELANE_AUTHORIZE_HANDLERS = [
  AuthorizeRequestOcpp16Handler,
  WirelaneAuthorizeRequestOcpp201Handler,
  AuthorizeRequestOcpp21Handler,
] satisfies ReadonlyArray<HandlerClass>;

/**
 * The handler classes of the Wirelane module for the given config.
 *
 * The Authorize handlers are added only when EVDriver excludes Authorize
 * (`modules.evdriver.excludedRequests`), so Authorize is never answered by two modules.
 * `remoteAuthorization.enabled` without that exclusion has no effect and is logged.
 */
export function selectWirelaneHandlerClasses(
  config: SystemConfig,
  logger: Logger<ILogObj>,
): ReadonlyArray<HandlerClass> {
  if (config.modules.evdriver?.excludedRequests?.includes(OCPP_CallAction.Authorize)) {
    return [...WIRELANE_HANDLERS, ...WIRELANE_AUTHORIZE_HANDLERS];
  }
  if (config.modules.wirelane?.remoteAuthorization?.enabled) {
    logger.warn(
      'modules.wirelane.remoteAuthorization.enabled is set, but modules.evdriver.excludedRequests ' +
        'does not contain Authorize: EVDriver keeps answering Authorize with local authorization.',
    );
  }
  return WIRELANE_HANDLERS;
}

/**
 * Registers the WirelaneIntegration module's internal services as scoped dependencies.
 *
 * Also replaces the Transactions module's `transactionService` with
 * {@link WirelaneTransactionService}. That only works because the app calls this registrar
 * after `registerTransactionsServices` (`registerModuleServices` in
 * apps/ocpp-server/src/container.ts): the later registration of a token wins.
 */
export function registerWirelaneServices(container: AwilixContainer): void {
  container.register({
    stationDiscoveryNotifier: asClass(StationDiscoveryNotifier).scoped(),
    wirelaneAuthorizationClient: asClass(WirelaneAuthorizationClient).scoped(),
    transactionService: asClass(WirelaneTransactionService).scoped(),
    wirelaneHandlers: asFunction(
      (
        cradle: HandlerResolverCradle & { config: SystemConfig; logger: Logger<ILogObj> },
      ): AbstractHandler[] =>
        buildHandlers(
          cradle.moduleScope,
          selectWirelaneHandlerClasses(cradle.config, cradle.logger),
        ),
    ).scoped(),
  });
}
