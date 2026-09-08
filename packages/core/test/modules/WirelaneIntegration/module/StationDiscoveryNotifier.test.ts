// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@citrineos/base';
import type { SystemConfig } from '@citrineos/types';
import { StationDiscoveryNotifier } from '@modules/WirelaneIntegration/src/module/StationDiscoveryNotifier.js';
import { createTestContainer } from '@test/testContainer.js';

describe('StationDiscoveryNotifier', () => {
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

  function createNotifier(overrides?: { adapterBaseUrl?: string }): StationDiscoveryNotifier {
    const config = {
      modules: {
        wirelane: {
          ocppAdapterBaseUrl:
            overrides && 'adapterBaseUrl' in overrides
              ? overrides.adapterBaseUrl
              : ADAPTER_BASE_URL,
        },
      },
    } as unknown as SystemConfig;

    const { logger } = createTestContainer();

    return new StationDiscoveryNotifier({
      config: config as any,
      logger: logger as any,
      webhookDispatcher: webhookDispatcher as any,
    });
  }

  it('POSTs discovery then reloads subscriptions', async () => {
    const notifier = createNotifier();

    await notifier.notifyDiscoveredAndReload({
      csms: 'citrineos',
      stationId: 'TEST001',
      tenantId: DEFAULT_TENANT_ID,
      protocol: 'ocpp2.0.1',
      vendor: 'Vendor',
      model: 'Model',
      serialNumber: 'SN',
      firmwareVersion: '1.0',
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
          protocol: 'ocpp2.0.1',
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

  it('does not reload subscriptions when discovery POST fails', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });
    const notifier = createNotifier();

    await notifier.notifyDiscoveredAndReload({
      csms: 'citrineos',
      stationId: 'TEST001',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(webhookDispatcher.reloadSubscriptions).not.toHaveBeenCalled();
  });

  it('skips discovery when ocppAdapterBaseUrl is not configured', async () => {
    const notifier = createNotifier({ adapterBaseUrl: undefined });

    await notifier.notifyDiscoveredAndReload({
      csms: 'citrineos',
      stationId: 'TEST001',
      tenantId: DEFAULT_TENANT_ID,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(webhookDispatcher.reloadSubscriptions).not.toHaveBeenCalled();
  });
});
