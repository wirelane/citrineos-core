// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import type { SystemConfig } from '@citrineos/types';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import type { WirelaneWebhookDispatcher } from './wirelane-webhook-dispatcher.js';

export type StationDiscoveryBody = {
  csms: 'citrineos';
  stationId: string;
  tenantId: number;
  protocol?: string;
  vendor?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
};

export interface StationDiscoveryNotifierDependencies {
  config: SystemConfig;
  logger?: Logger<ILogObj>;
  webhookDispatcher: WirelaneWebhookDispatcher;
}

/**
 * POSTs discovered station identity to ocpp-adapter on BootNotification, then
 * reloads live subscription maps so StatusNotification on this websocket is
 * forwarded. Shared by the OCPP 2.0.1 and 1.6 Wirelane BootNotification handlers.
 */
export class StationDiscoveryNotifier {
  private readonly _logger: Logger<ILogObj>;
  private readonly _webhookDispatcher: WirelaneWebhookDispatcher;
  private readonly _adapterBaseUrl?: string;

  constructor({ config, logger, webhookDispatcher }: StationDiscoveryNotifierDependencies) {
    this._logger = logger
      ? logger.getSubLogger({ name: this.constructor.name })
      : new Logger<ILogObj>({ name: this.constructor.name });
    this._webhookDispatcher = webhookDispatcher;
    this._adapterBaseUrl = config.wirelane?.ocppAdapterBaseUrl;
  }

  async notifyDiscoveredAndReload(body: StationDiscoveryBody): Promise<void> {
    const baseUrl = this._adapterBaseUrl;
    if (!baseUrl) {
      this._logger.warn('Skipping ocpp-adapter discovery: wirelane.ocppAdapterBaseUrl is not set', {
        stationId: body.stationId,
      });
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
