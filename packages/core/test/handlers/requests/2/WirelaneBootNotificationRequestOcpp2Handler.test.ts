// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type IMessage, DEFAULT_TENANT_ID } from '@citrineos/base';
import {
  EventGroup,
  MessageOrigin,
  MessageState,
  type OCPP2_request_types,
  OCPP_CallAction,
  OCPPVersion,
} from '@citrineos/types';
import { WirelaneBootNotificationRequestOcpp2Handler } from '@handlers/index.js';
import { createTestContainer } from '@test/testContainer.js';

function makeMessage(
  payload: OCPP2_request_types.BootNotificationRequest,
): IMessage<OCPP2_request_types.BootNotificationRequest> {
  return {
    context: {
      tenantId: DEFAULT_TENANT_ID,
      ocppConnectionName: 'TEST001',
      correlationId: 'corr-001',
      timestamp: new Date().toISOString(),
    },
    payload,
    origin: MessageOrigin.ChargingStationManagementSystem,
    eventGroup: EventGroup.Wirelane,
    action: OCPP_CallAction.BootNotification,
    state: MessageState.Request,
    protocol: OCPPVersion.OCPP2_0_1,
  } as unknown as IMessage<OCPP2_request_types.BootNotificationRequest>;
}

describe('WirelaneBootNotificationRequestOcpp2Handler', () => {
  let handler: WirelaneBootNotificationRequestOcpp2Handler;
  let stationDiscoveryNotifier: { notifyDiscoveredAndReload: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const { logger } = createTestContainer();
    stationDiscoveryNotifier = { notifyDiscoveredAndReload: vi.fn().mockResolvedValue(undefined) };

    handler = new WirelaneBootNotificationRequestOcpp2Handler({
      logger,
      stationDiscoveryNotifier: stationDiscoveryNotifier as any,
    });
  });

  it('notifies discovery with fields mapped from the OCPP 2.0.1 payload', async () => {
    await handler.handle(
      makeMessage({
        chargingStation: {
          vendorName: 'Vendor',
          model: 'Model',
          serialNumber: 'SN',
          firmwareVersion: '1.0',
        },
      } as OCPP2_request_types.BootNotificationRequest),
    );

    expect(stationDiscoveryNotifier.notifyDiscoveredAndReload).toHaveBeenCalledWith({
      csms: 'citrineos',
      stationId: 'TEST001',
      tenantId: DEFAULT_TENANT_ID,
      protocol: OCPPVersion.OCPP2_0_1,
      vendor: 'Vendor',
      model: 'Model',
      serialNumber: 'SN',
      firmwareVersion: '1.0',
    });
  });
});
