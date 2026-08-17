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
import type { ISubscriptionRepository } from '@dal/interfaces/repositories.js';
import { Subscription } from '@dal/layers/sequelize/index.js';

export interface WirelaneIntegrationModuleDependencies extends OcppModuleDependencies {
  subscriptionRepository: ISubscriptionRepository;
}

type BootPayloadFields = {
  vendor?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  firmwareVersion?: string | null;
};

export class WirelaneIntegrationModule extends AbstractModule {
  _requests: CallAction[] = [];
  _responses: CallAction[] = [];

  protected _subscriptionRepository: ISubscriptionRepository;

  constructor({
    config,
    cache,
    sender,
    handler,
    logger,
    ocppValidator,
    subscriptionRepository,
  }: WirelaneIntegrationModuleDependencies) {
    super(config, cache, handler, sender, EventGroup.Wirelane, logger, ocppValidator);
    this._requests = config.modules.wirelane?.requests ?? [];
    this._responses = config.modules.wirelane?.responses ?? [];
    this._subscriptionRepository = subscriptionRepository;
  }

  @AsHandler(OCPP_2_VER_LIST, OCPP_CallAction.BootNotification)
  protected async _handleBootNotification(
    message: IMessage<OCPP2_request_types.BootNotificationRequest>,
    props?: HandlerProperties,
  ): Promise<void> {
    this._logger.debug('Wirelane BootNotification (2.x) observed:', message, props);

    const chargingStation = message.payload.chargingStation;
    await this._onBootDiscovered({
      tenantId: message.context.tenantId,
      ocppConnectionName: message.context.ocppConnectionName,
      protocol: message.protocol,
      boot: {
        vendor: chargingStation?.vendorName,
        model: chargingStation?.model,
        serialNumber: chargingStation?.serialNumber,
        firmwareVersion: chargingStation?.firmwareVersion,
      },
    });
  }

  @AsHandler([OCPPVersion.OCPP1_6], OCPP_CallAction.BootNotification)
  protected async _handleOcpp16BootNotification(
    message: IMessage<OCPP1_6.BootNotificationRequest>,
    props?: HandlerProperties,
  ): Promise<void> {
    this._logger.debug('Wirelane BootNotification (1.6) observed:', message, props);

    await this._onBootDiscovered({
      tenantId: message.context.tenantId,
      ocppConnectionName: message.context.ocppConnectionName,
      protocol: message.protocol,
      boot: {
        vendor: message.payload.chargePointVendor,
        model: message.payload.chargePointModel,
        serialNumber: message.payload.chargePointSerialNumber,
        firmwareVersion: message.payload.firmwareVersion,
      },
    });
  }

  private async _onBootDiscovered(params: {
    tenantId: number;
    ocppConnectionName: string;
    protocol?: string;
    boot: BootPayloadFields;
  }): Promise<void> {
    const wirelaneConfig = this._config.modules.wirelane;
    if (!wirelaneConfig?.ocppAdapterBaseUrl || !wirelaneConfig?.ocppAdapterWebhookUrl) {
      this._logger.warn(
        'Wirelane module enabled but ocppAdapterBaseUrl / ocppAdapterWebhookUrl are missing; skipping discovery',
      );
      return;
    }

    try {
      await this._ensureSubscription(
        params.tenantId,
        params.ocppConnectionName,
        wirelaneConfig.ocppAdapterWebhookUrl,
      );
    } catch (error) {
      this._logger.error('Failed to ensure CitrineOS subscription for Wirelane adapter', {
        ocppConnectionName: params.ocppConnectionName,
        error,
      });
    }

    try {
      await this._notifyAdapterDiscovered(wirelaneConfig.ocppAdapterBaseUrl, params);
    } catch (error) {
      this._logger.error('Failed to notify ocpp-adapter of station discovery', {
        ocppConnectionName: params.ocppConnectionName,
        error,
      });
    }
  }

  private async _ensureSubscription(
    tenantId: number,
    ocppConnectionName: string,
    webhookUrl: string,
  ): Promise<void> {
    const existing = await this._subscriptionRepository.readAllByStationId(
      tenantId,
      ocppConnectionName,
    );
    if (existing.some((subscription) => subscription.url === webhookUrl)) {
      return;
    }

    await this._subscriptionRepository.create(
      tenantId,
      Subscription.build({
        ocppConnectionName,
        url: webhookUrl,
        onConnect: true,
        onClose: true,
        onMessage: true,
        sentMessage: false,
        messageRegexFilter: 'BootNotification|StatusNotification',
      }),
    );

    this._logger.info('Created Wirelane ocpp-adapter subscription', {
      ocppConnectionName,
      webhookUrl,
    });
  }

  private async _notifyAdapterDiscovered(
    adapterBaseUrl: string,
    params: {
      tenantId: number;
      ocppConnectionName: string;
      protocol?: string;
      boot: BootPayloadFields;
    },
  ): Promise<void> {
    const url = `${adapterBaseUrl.replace(/\/$/, '')}/internal/stations/discovered`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        csms: 'citrineos',
        stationId: params.ocppConnectionName,
        tenantId: params.tenantId,
        protocol: params.protocol,
        vendor: params.boot.vendor,
        model: params.boot.model,
        serialNumber: params.boot.serialNumber,
        firmwareVersion: params.boot.firmwareVersion,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `ocpp-adapter discovery returned HTTP ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    this._logger.info('Notified ocpp-adapter of discovered station', {
      ocppConnectionName: params.ocppConnectionName,
    });
  }
}

export default WirelaneIntegrationModule;
