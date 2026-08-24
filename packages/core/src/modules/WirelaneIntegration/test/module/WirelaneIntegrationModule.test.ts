// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TENANT_ID,
  EventGroup,
  OCPP_CallAction,
  OCPPVersion,
  type SystemConfig,
} from '@citrineos/base';
import { WirelaneIntegrationModule } from '../../src/module/module.js';

describe('WirelaneIntegrationModule', () => {
  const ADAPTER_BASE_URL = 'http://ocpp-adapter.internal';
  const fetch = vi.fn();
  const webhookDispatcher = {
    reloadSubscriptions: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });
    global.fetch = fetch;
  });

  afterEach(() => {
    fetch.mockReset();
    webhookDispatcher.reloadSubscriptions.mockClear();
  });

  function createModule(overrides?: { adapterBaseUrl?: string; requests?: OCPP_CallAction[] }) {
    const config = {
      modules: {
        wirelane: {
          endpointPrefix: '/wirelane',
          requests: overrides?.requests ?? [OCPP_CallAction.BootNotification],
          responses: [],
          ocppAdapterBaseUrl:
            overrides && 'adapterBaseUrl' in overrides
              ? overrides.adapterBaseUrl
              : ADAPTER_BASE_URL,
          ocppAdapterWebhookUrl: `${ADAPTER_BASE_URL}/webhook/citrineos`,
        },
      },
    } as unknown as SystemConfig;

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      getSubLogger: vi.fn(),
    };
    logger.getSubLogger.mockReturnValue(logger);

    return new WirelaneIntegrationModule({
      config,
      cache: {} as any,
      sender: {} as any,
      handler: {
        subscribe: vi.fn().mockResolvedValue(undefined),
      } as any,
      logger: logger as any,
      ocppValidator: {} as any,
      webhookDispatcher: webhookDispatcher as any,
    });
  }

  it('subscribes to BootNotification from config', () => {
    const module = createModule();
    expect(module['_eventGroup']).toBe(EventGroup.Wirelane);
    expect(module['_requests']).toEqual([OCPP_CallAction.BootNotification]);
    expect(module['_responses']).toEqual([]);
  });

  it('POSTs discovery then reloads subscriptions on OCPP 2.0.1 BootNotification', async () => {
    const module = createModule();

    await (module as any)._handleBootNotification({
      protocol: OCPPVersion.OCPP2_0_1,
      context: {
        tenantId: DEFAULT_TENANT_ID,
        ocppConnectionName: 'TEST001',
      },
      payload: {
        chargingStation: {
          vendorName: 'Vendor',
          model: 'Model',
          serialNumber: 'SN',
          firmwareVersion: '1.0',
        },
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      `${ADAPTER_BASE_URL}/internal/stations/discovered`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csms: 'citrineos',
          stationId: 'TEST001',
          tenantId: DEFAULT_TENANT_ID,
          protocol: OCPPVersion.OCPP2_0_1,
          vendor: 'Vendor',
          model: 'Model',
          serialNumber: 'SN',
          firmwareVersion: '1.0',
        }),
      }),
    );
    expect(webhookDispatcher.reloadSubscriptions).toHaveBeenCalledWith(
      DEFAULT_TENANT_ID,
      'TEST001',
    );
  });

  it('POSTs discovery then reloads subscriptions on OCPP 1.6 BootNotification', async () => {
    const module = createModule();

    await (module as any)._handleOcpp16BootNotification({
      protocol: OCPPVersion.OCPP1_6,
      context: {
        tenantId: DEFAULT_TENANT_ID,
        ocppConnectionName: 'TEST016',
      },
      payload: {
        chargePointVendor: 'Vendor16',
        chargePointModel: 'Model16',
        chargePointSerialNumber: 'SN16',
        firmwareVersion: '1.6',
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      `${ADAPTER_BASE_URL}/internal/stations/discovered`,
      expect.objectContaining({
        body: JSON.stringify({
          csms: 'citrineos',
          stationId: 'TEST016',
          tenantId: DEFAULT_TENANT_ID,
          protocol: OCPPVersion.OCPP1_6,
          vendor: 'Vendor16',
          model: 'Model16',
          serialNumber: 'SN16',
          firmwareVersion: '1.6',
        }),
      }),
    );
    expect(webhookDispatcher.reloadSubscriptions).toHaveBeenCalledWith(
      DEFAULT_TENANT_ID,
      'TEST016',
    );
  });

  it('does not reload subscriptions when discovery POST fails', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });
    const module = createModule();

    await (module as any)._handleBootNotification({
      protocol: OCPPVersion.OCPP2_0_1,
      context: {
        tenantId: DEFAULT_TENANT_ID,
        ocppConnectionName: 'TEST001',
      },
      payload: { chargingStation: { vendorName: 'Vendor', model: 'Model' } },
    });

    expect(webhookDispatcher.reloadSubscriptions).not.toHaveBeenCalled();
  });

  it('skips discovery when ocppAdapterBaseUrl is not configured', async () => {
    const module = createModule({ adapterBaseUrl: undefined });

    await (module as any)._handleBootNotification({
      protocol: OCPPVersion.OCPP2_0_1,
      context: {
        tenantId: DEFAULT_TENANT_ID,
        ocppConnectionName: 'TEST001',
      },
      payload: { chargingStation: { vendorName: 'Vendor', model: 'Model' } },
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(webhookDispatcher.reloadSubscriptions).not.toHaveBeenCalled();
  });
});
