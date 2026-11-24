// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import type { ISubscriptionRepository } from '@citrineos/dal';
import { MessageOrigin, MessageTypeId, OCPPVersion, type SubscriptionDto } from '@citrineos/types';
import { buildFrameEvent } from '@/transport/index.js';
import { WirelaneWebhookDispatcher } from '@modules/wirelane-integration/wirelane-webhook-dispatcher.js';
import { createTestContainer, getTestInstance } from '@test/test-container.js';
import { afterEach, beforeEach, describe, expect, it, type Mocked, vi } from 'vitest';
import { aSubscription } from '../ocpp-router/providers/subscription-provider.js';

describe('WirelaneWebhookDispatcher', () => {
  const { container } = createTestContainer();
  const fetch = vi.fn();

  let subscriptionRepository: Mocked<ISubscriptionRepository>;
  let dispatcher: WirelaneWebhookDispatcher;

  const STATUS_NOTIFICATION = [2, '7', 'StatusNotification', {}];

  function givenSubscriptions(...subscriptions: SubscriptionDto[]) {
    subscriptionRepository.readAllByStationId.mockResolvedValue(subscriptions);
  }

  beforeEach(() => {
    fetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
    global.fetch = fetch;
    subscriptionRepository = {
      readAllByStationId: vi.fn().mockResolvedValue([]),
    } as unknown as Mocked<ISubscriptionRepository>;
    dispatcher = getTestInstance(container, WirelaneWebhookDispatcher, { subscriptionRepository });
  });

  afterEach(() => {
    dispatcher.shutdown();
    fetch.mockReset();
  });

  describe('a connected station', () => {
    const withoutWebhook = aSubscription({ onConnect: false, onMessage: false });
    const withWebhook = aSubscription({
      ocppConnectionName: withoutWebhook.ocppConnectionName,
      tenantId: withoutWebhook.tenantId,
      onConnect: true,
      onMessage: true,
      messageRegexFilter: 'StatusNotification',
    });

    beforeEach(async () => {
      givenSubscriptions(withoutWebhook);
      await dispatcher.register(withoutWebhook.tenantId!, withoutWebhook.ocppConnectionName);
      fetch.mockClear();
      givenSubscriptions(withWebhook);
    });

    it('loads a subscription created after the connect and fires its onConnect', async () => {
      await dispatcher.reloadSubscriptions(withWebhook.tenantId!, withWebhook.ocppConnectionName);

      expect(subscriptionRepository.readAllByStationId).toHaveBeenLastCalledWith(
        withWebhook.tenantId,
        withWebhook.ocppConnectionName,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(withWebhook.url, expect.anything());
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        ocppConnectionName: withWebhook.ocppConnectionName,
        event: 'connected',
      });
    });

    it('forwards the next frame to the reloaded subscription', async () => {
      await dispatcher.reloadSubscriptions(withWebhook.tenantId!, withWebhook.ocppConnectionName);
      fetch.mockClear();

      await dispatcher.dispatchFrame(statusNotificationFrame(withWebhook));

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(withWebhook.url, expect.anything());
    });

    it('without a reload, the next frame still goes to the subscriptions loaded on connect', async () => {
      await dispatcher.dispatchFrame(statusNotificationFrame(withWebhook));

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it('skips a station it does not know yet', async () => {
    const subscription = aSubscription({ onConnect: true });
    givenSubscriptions(subscription);

    await dispatcher.reloadSubscriptions(subscription.tenantId!, subscription.ocppConnectionName);

    expect(subscriptionRepository.readAllByStationId).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  function statusNotificationFrame(subscription: SubscriptionDto) {
    return buildFrameEvent({
      tenantId: subscription.tenantId!,
      ocppConnectionName: subscription.ocppConnectionName,
      origin: MessageOrigin.ChargingStation,
      correlationId: '7',
      protocol: OCPPVersion.OCPP2_0_1,
      raw: JSON.stringify(STATUS_NOTIFICATION),
      timestamp: new Date().toISOString(),
      type: MessageTypeId.Call,
      action: 'StatusNotification',
      rpcMessage: STATUS_NOTIFICATION,
    });
  }
});
