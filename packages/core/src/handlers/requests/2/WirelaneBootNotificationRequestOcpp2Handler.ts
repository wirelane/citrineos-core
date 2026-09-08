// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import {
  AbstractHandler,
  type AbstractHandlerDependencies,
  AsRequestHandler,
  type IMessage,
  type OCPP2_request_types,
} from '@citrineos/base';
import { type HandlerProperties, OCPP_2_VER_LIST, OCPP_CallAction } from '@citrineos/types';
import { StationDiscoveryNotifier } from '@modules/WirelaneIntegration/src/module/StationDiscoveryNotifier.js';

/**
 * Observe-only: Configuration's own BootNotificationRequestOcpp2Handler still
 * answers the charger. This handler additionally notifies ocpp-adapter of the
 * discovered station, independent of that response.
 */
@AsRequestHandler(OCPP_2_VER_LIST, OCPP_CallAction.BootNotification)
export class WirelaneBootNotificationRequestOcpp2Handler extends AbstractHandler {
  private readonly _stationDiscoveryNotifier: StationDiscoveryNotifier;

  constructor({
    logger,
    stationDiscoveryNotifier,
  }: AbstractHandlerDependencies & {
    stationDiscoveryNotifier: StationDiscoveryNotifier;
  }) {
    super(logger);
    this._stationDiscoveryNotifier = stationDiscoveryNotifier;
  }

  async handle(
    message: IMessage<OCPP2_request_types.BootNotificationRequest>,
    props?: HandlerProperties,
  ): Promise<void> {
    this._logger.debug(
      this.createHandlerReceivedMessageLog('Wirelane BootNotificationRequest'),
      message,
      props,
    );

    const chargingStation = message.payload.chargingStation;
    await this._stationDiscoveryNotifier.notifyDiscoveredAndReload({
      csms: 'citrineos',
      stationId: message.context.ocppConnectionName,
      tenantId: message.context.tenantId,
      protocol: message.protocol,
      vendor: chargingStation.vendorName,
      model: chargingStation.model,
      serialNumber: chargingStation.serialNumber ?? undefined,
      firmwareVersion: chargingStation.firmwareVersion ?? undefined,
    });
  }
}
