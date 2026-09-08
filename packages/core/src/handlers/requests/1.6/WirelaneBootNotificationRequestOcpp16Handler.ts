// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import {
  AbstractHandler,
  type AbstractHandlerDependencies,
  AsRequestHandler,
  type IMessage,
} from '@citrineos/base';
import { type HandlerProperties, OCPP1_6, OCPP_CallAction, OCPPVersion } from '@citrineos/types';
import { StationDiscoveryNotifier } from '@modules/WirelaneIntegration/src/module/StationDiscoveryNotifier.js';

/**
 * Observe-only: Configuration's own BootNotificationRequestOcpp16Handler still
 * answers the charger. This handler additionally notifies ocpp-adapter of the
 * discovered station, independent of that response.
 */
@AsRequestHandler([OCPPVersion.OCPP1_6], OCPP_CallAction.BootNotification)
export class WirelaneBootNotificationRequestOcpp16Handler extends AbstractHandler {
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
    message: IMessage<OCPP1_6.BootNotificationRequest>,
    props?: HandlerProperties,
  ): Promise<void> {
    this._logger.debug(
      this.createHandlerReceivedMessageLog('Wirelane OCPP 1.6 BootNotificationRequest'),
      message,
      props,
    );

    const request = message.payload;
    await this._stationDiscoveryNotifier.notifyDiscoveredAndReload({
      csms: 'citrineos',
      stationId: message.context.ocppConnectionName,
      tenantId: message.context.tenantId,
      protocol: message.protocol,
      vendor: request.chargePointVendor,
      model: request.chargePointModel,
      serialNumber: request.chargePointSerialNumber ?? undefined,
      firmwareVersion: request.firmwareVersion ?? undefined,
    });
  }
}
