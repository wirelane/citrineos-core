// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Wirelane integration module.
 *
 * Observe-only BootNotification handler that POSTs station identity to
 * ocpp-adapter over HTTP. The adapter then subscribes via the CitrineOS
 * Data API; this module reloads live subscription maps afterwards so
 * StatusNotification on the first websocket is forwarded.
 */
export { WirelaneIntegrationModule } from './module/module.js';
export type { WirelaneIntegrationModuleDependencies } from './module/module.js';
