// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Wirelane integration module.
 *
 * Station discovery and the ocpp-adapter webhook subscription live on
 * WebhookDispatcher (created at websocket connect). This module is the
 * home for future custom Authorize (and related) handlers that call
 * ocpp-adapter; it currently starts with an empty action list.
 */
export { WirelaneIntegrationModule } from './module/module.js';
