// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import {
  AbstractHandler,
  AbstractModule,
  type IOcppSender,
  type OcppModuleDependencies,
} from '@citrineos/base';
import { EventGroup } from '@citrineos/types';

export interface WirelaneIntegrationModuleDependencies extends OcppModuleDependencies {
  ocppSender: IOcppSender;
  wirelaneHandlers: AbstractHandler[];
}

/**
 * Observe-only BootNotification handler. Configuration still answers the
 * charger; this module's handlers (see WirelaneBootNotificationRequestOcpp2Handler
 * / WirelaneBootNotificationRequestOcpp16Handler) additionally POST station
 * identity to ocpp-adapter and reload live subscription maps so
 * StatusNotification is forwarded on the first websocket.
 */
export class WirelaneIntegrationModule extends AbstractModule {
  constructor({
    config,
    cache,
    sender,
    handler,
    logger,
    ocppValidator,
    ocppSender,
    wirelaneHandlers,
  }: WirelaneIntegrationModuleDependencies) {
    super(
      config,
      cache,
      handler,
      sender,
      EventGroup.Wirelane,
      ocppSender,
      logger,
      ocppValidator,
      wirelaneHandlers,
    );
  }
}

export default WirelaneIntegrationModule;
