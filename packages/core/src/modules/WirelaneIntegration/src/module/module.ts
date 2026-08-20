// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import type {
  CallAction,
  HandlerProperties,
  IMessage,
  OcppModuleDependencies,
  OCPP2_request_types,
} from '@citrineos/base';
import {
  AbstractModule,
  AsHandler,
  EventGroup,
  OCPP1_6,
  OCPP_2_VER_LIST,
  OCPP_CallAction,
  OCPPVersion,
} from '@citrineos/base';
import { WebhookDispatcher } from '@modules/OcppRouter/src/module/webhook.dispatcher.js';

export interface WirelaneIntegrationModuleDependencies extends OcppModuleDependencies {
  webhookDispatcher: WebhookDispatcher;
}

type StationDiscoveryBody = {
  csms: 'citrineos';
  stationId: string;
  tenantId: number;
  protocol?: string;
  vendor?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
};

/**
 * Observe-only BootNotification handler. Configuration still answers the charger.
 * On Boot we POST identity to ocpp-adapter (HTTP); the adapter then subscribes
 * via the CitrineOS Data API. After that HTTP round-trip we reload live
 * subscription maps so StatusNotification on this websocket is forwarded.
 */
export class WirelaneIntegrationModule extends AbstractModule {
  _requests: CallAction[] = [];
  _responses: CallAction[] = [];

  private readonly _webhookDispatcher: WebhookDispatcher;
  private readonly _adapterBaseUrl?: string;

  constructor({
    config,
    cache,
    sender,
    handler,
    logger,
    ocppValidator,
    webhookDispatcher,
  }: WirelaneIntegrationModuleDependencies) {
    super(config, cache, handler, sender, EventGroup.Wirelane, logger, ocppValidator);
    this._requests = config.modules.wirelane?.requests ?? [];
    this._responses = config.modules.wirelane?.responses ?? [];
    this._webhookDispatcher = webhookDispatcher;
    this._adapterBaseUrl = config.modules.wirelane?.ocppAdapterBaseUrl;
  }

  @AsHandler(OCPP_2_VER_LIST, OCPP_CallAction.BootNotification)
  protected async _handleBootNotification(
    message: IMessage<OCPP2_request_types.BootNotificationRequest>,
    props?: HandlerProperties,
  ): Promise<void> {
    this._logger.debug('Wirelane BootNotification received:', message, props);
    const chargingStation = message.payload.chargingStation;
    await this._notifyDiscoveredAndReload({
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

  @AsHandler([OCPPVersion.OCPP1_6], OCPP_CallAction.BootNotification)
  protected async _handleOcpp16BootNotification(
    message: IMessage<OCPP1_6.BootNotificationRequest>,
    props?: HandlerProperties,
  ): Promise<void> {
    this._logger.debug('Wirelane OCPP 1.6 BootNotification received:', message, props);
    const request = message.payload;
    await this._notifyDiscoveredAndReload({
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

  private async _notifyDiscoveredAndReload(body: StationDiscoveryBody): Promise<void> {
    const baseUrl = this._adapterBaseUrl;
    if (!baseUrl) {
      this._logger.warn(
        'Skipping ocpp-adapter discovery: modules.wirelane.ocppAdapterBaseUrl is not set',
        { stationId: body.stationId },
      );
      return;
    }

    try {
      const url = `${baseUrl.replace(/\/$/, '')}/internal/stations/discovered`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const errorText = await response.text();
        this._logger.error('ocpp-adapter discovery POST failed', {
          stationId: body.stationId,
          status: response.status,
          errorText,
        });
        return;
      }
      this._logger.info('Notified ocpp-adapter of discovered station', {
        stationId: body.stationId,
      });
    } catch (error) {
      this._logger.error('ocpp-adapter discovery POST failed', {
        stationId: body.stationId,
        error,
      });
      return;
    }

    try {
      await this._webhookDispatcher.reloadSubscriptions(body.tenantId, body.stationId);
    } catch (error) {
      this._logger.error('Failed to reload subscriptions after discovery', {
        stationId: body.stationId,
        error,
      });
    }
  }
}

export default WirelaneIntegrationModule;
