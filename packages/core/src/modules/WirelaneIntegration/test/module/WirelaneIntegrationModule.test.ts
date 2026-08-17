// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  EventGroup,
  OCPPVersion,
  OCPP_CallAction,
  type SystemConfig,
} from '@citrineos/base';
import { WirelaneIntegrationModule } from '../src/module/module.js';

describe('WirelaneIntegrationModule', () => {
  const subscriptionRepository = {
    readAllByStationId: vi.fn(),
    create: vi.fn(),
  };

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getSubLogger: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logger.getSubLogger.mockReturnValue(logger);
    subscriptionRepository.readAllByStationId.mockResolvedValue([]);
    subscriptionRepository.create.mockResolvedValue({ id: 1 });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    }) as any;
  });

  function createModule() {
    const config = {
      modules: {
        wirelane: {
          endpointPrefix: '/wirelane',
          requests: [OCPP_CallAction.BootNotification],
          responses: [],
          ocppAdapterBaseUrl: 'http://ocpp-adapter.internal',
          ocppAdapterWebhookUrl: 'http://ocpp-adapter.internal/webhook/citrineos',
        },
      },
    } as unknown as SystemConfig;

    return new WirelaneIntegrationModule({
      config,
      cache: {} as any,
      sender: {} as any,
      handler: {
        subscribe: vi.fn().mockResolvedValue(undefined),
      } as any,
      logger: logger as any,
      ocppValidator: {} as any,
      subscriptionRepository: subscriptionRepository as any,
    });
  }

  it('creates subscription and notifies adapter on BootNotification', async () => {
    const module = createModule();

    await (module as any)._handleBootNotification({
      protocol: OCPPVersion.OCPP2_0_1,
      context: {
        tenantId: 1,
        ocppConnectionName: 'TEST001',
        correlationId: 'abc',
        timestamp: new Date().toISOString(),
      },
      payload: {
        reason: 'PowerUp',
        chargingStation: {
          vendorName: 'Vendor',
          model: 'Model',
          serialNumber: 'SN',
        },
      },
      action: OCPP_CallAction.BootNotification,
      origin: 'cs',
      state: 1,
      eventGroup: EventGroup.Wirelane,
    });

    expect(subscriptionRepository.create).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://ocpp-adapter.internal/internal/stations/discovered',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const fetchCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body).toMatchObject({
      csms: 'citrineos',
      stationId: 'TEST001',
      tenantId: 1,
      vendor: 'Vendor',
      model: 'Model',
      serialNumber: 'SN',
    });
  });

  it('skips subscription create when webhook already exists', async () => {
    subscriptionRepository.readAllByStationId.mockResolvedValue([
      { url: 'http://ocpp-adapter.internal/webhook/citrineos' },
    ]);
    const module = createModule();

    await (module as any)._handleBootNotification({
      protocol: OCPPVersion.OCPP2_0_1,
      context: {
        tenantId: 1,
        ocppConnectionName: 'TEST001',
        correlationId: 'abc',
        timestamp: new Date().toISOString(),
      },
      payload: {
        reason: 'PowerUp',
        chargingStation: { vendorName: 'Vendor', model: 'Model' },
      },
      action: OCPP_CallAction.BootNotification,
      origin: 'cs',
      state: 1,
      eventGroup: EventGroup.Wirelane,
    });

    expect(subscriptionRepository.create).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
