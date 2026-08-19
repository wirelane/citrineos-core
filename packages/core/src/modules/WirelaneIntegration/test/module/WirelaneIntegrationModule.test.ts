// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { EventGroup, OCPP_CallAction, type SystemConfig } from '@citrineos/base';
import { WirelaneIntegrationModule } from '../../src/module/module.js';

describe('WirelaneIntegrationModule', () => {
  it('ignores config.requests until Authorize handlers exist so leftover BootNotification does not crash', () => {
    const config = {
      modules: {
        wirelane: {
          endpointPrefix: '/wirelane',
          requests: [OCPP_CallAction.BootNotification],
          responses: [],
          ocppAdapterWebhookUrl: 'http://ocpp-adapter.internal/webhook/citrineos',
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

    const module = new WirelaneIntegrationModule({
      config,
      cache: {} as any,
      sender: {} as any,
      handler: {
        subscribe: vi.fn().mockResolvedValue(undefined),
      } as any,
      logger: logger as any,
      ocppValidator: {} as any,
    });

    expect(module['_eventGroup']).toBe(EventGroup.Wirelane);
    expect(module['_requests']).toEqual([]);
    expect(module['_responses']).toEqual([]);
  });
});
