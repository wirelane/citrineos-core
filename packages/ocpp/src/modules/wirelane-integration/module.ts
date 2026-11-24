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
 * Wirelane module (event group `wirelane`), handlers in `WIRELANE_HANDLERS` (register.ts):
 * observes BootNotification (Configuration still answers it) to report the station to
 * ocpp-adapter, and answers Authorize in place of EVDriver.
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
