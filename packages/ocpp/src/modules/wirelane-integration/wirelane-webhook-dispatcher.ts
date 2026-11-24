// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { createIdentifier } from '@citrineos/base';
import { WebhookDispatcher } from '@modules/messages/webhook-dispatcher.js';

/**
 * Replaces the `webhookDispatcher` registration (see `WirelaneCitrineOSServer`) to reload a
 * connected station's subscriptions on demand.
 */
export class WirelaneWebhookDispatcher extends WebhookDispatcher {
  /**
   * Reloads the subscriptions of a connected station from the database and fires their onConnect
   * callbacks. Creating a subscription only inserts a row, and the dispatcher keeps an already
   * known station's subscriptions in memory until the next 3-minute refresh, so ocpp-adapter's
   * subscription from the BootNotification discovery would miss the first StatusNotifications.
   * A station the dispatcher does not know yet is skipped: its subscriptions are loaded when its
   * first frame or connect event is dispatched.
   */
  async reloadSubscriptions(tenantId: number, ocppConnectionName: string): Promise<void> {
    const identifier = createIdentifier(tenantId, ocppConnectionName);
    if (!this._identifiers.has(identifier)) {
      return;
    }

    await this._loadSubscriptionsForConnection(tenantId, ocppConnectionName);
    await Promise.all(
      this._onConnectionCallbacks.get(identifier)?.map((callback) => callback()) ?? [],
    );
  }
}
