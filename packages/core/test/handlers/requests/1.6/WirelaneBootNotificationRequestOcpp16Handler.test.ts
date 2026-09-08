// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type IMessage, DEFAULT_TENANT_ID } from '@citrineos/base';
import {
  EventGroup,
  MessageOrigin,
  MessageState,
  OCPP1_6,
  OCPP_CallAction,
  OCPPVersion,
} from '@citrineos/types';
import { WirelaneBootNotificationRequestOcpp16Handler } from '@handlers/index.js';
import { createTestContainer } from '@test/testContainer.js';

function makeMessage(
  payload: OCPP1_6.BootNotificationRequest,
): IMessage<OCPP1_6.BootNotificationRequest> {
  return {
    context: {
      tenantId: DEFAULT_TENANT_ID,
      ocppConnectionName: 'TEST016',
      correlationId: 'corr-001',
      timestamp: new Date().toISOString(),
    },
    payload,
    origin: MessageOrigin.ChargingStationManagementSystem,
    eventGroup: EventGroup.Wirelane,
    action: OCPP_CallAction.BootNotification,
    state: MessageState.Request,
    protocol: OCPPVersion.OCPP1_6,
  } as unknown as IMessage<OCPP1_6.BootNotificationRequest>;
}

describe('WirelaneBootNotificationRequestOcpp16Handler', () => {
  let handler: WirelaneBootNotificationRequestOcpp16Handler;
  let stationDiscoveryNotifier: { notifyDiscoveredAndReload: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const { logger } = createTestContainer();
    stationDiscoveryNotifier = { notifyDiscoveredAndReload: vi.fn().mockResolvedValue(undefined) };

    handler = new WirelaneBootNotificationRequestOcpp16Handler({
      logger,
      stationDiscoveryNotifier: stationDiscoveryNotifier as any,
    });
  });

  it('notifies discovery with fields mapped from the OCPP 1.6 payload', async () => {
    await handler.handle(
      makeMessage({
        chargePointVendor: 'Vendor16',
        chargePointModel: 'Model16',
        chargePointSerialNumber: 'SN16',
        firmwareVersion: '1.6',
      } as OCPP1_6.BootNotificationRequest),
    );

    expect(stationDiscoveryNotifier.notifyDiscoveredAndReload).toHaveBeenCalledWith({
      csms: 'citrineos',
      stationId: 'TEST016',
      tenantId: DEFAULT_TENANT_ID,
      protocol: OCPPVersion.OCPP1_6,
      vendor: 'Vendor16',
      model: 'Model16',
      serialNumber: 'SN16',
      firmwareVersion: '1.6',
    });
  });
});
