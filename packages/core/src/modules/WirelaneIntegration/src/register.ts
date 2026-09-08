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
import { StationDiscoveryNotifier } from './module/StationDiscoveryNotifier.js';
import {
  WirelaneBootNotificationRequestOcpp16Handler,
  WirelaneBootNotificationRequestOcpp2Handler,
} from '@handlers/index.js';

const WIRELANE_HANDLERS = [
  WirelaneBootNotificationRequestOcpp16Handler,
  WirelaneBootNotificationRequestOcpp2Handler,
] satisfies ReadonlyArray<HandlerClass>;

/**
 * Registers the WirelaneIntegration module's internal services as scoped dependencies.
 */
export function registerWirelaneServices(container: AwilixContainer): void {
  container.register({
    stationDiscoveryNotifier: asClass(StationDiscoveryNotifier).scoped(),
    wirelaneHandlers: asFunction((cradle: HandlerResolverCradle): AbstractHandler[] =>
      buildHandlers(cradle.moduleScope, WIRELANE_HANDLERS),
    ).scoped(),
  });
}
