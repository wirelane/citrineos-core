// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { EventGroup } from '@citrineos/types';
import type { AwilixContainer } from 'awilix';
import {
  type ApiInitSpec,
  CitrineOSServer,
  type ModuleInitSpec,
} from '@/server/citrineos-server.js';
import { registerWirelaneServices } from './register.js';

/**
 * The CitrineOS server with the Wirelane module, its API and its overrides of upstream
 * registrations (see `registerWirelaneServices`). Started by apps/ocpp-server.
 */
export class WirelaneCitrineOSServer extends CitrineOSServer {
  protected override get moduleSpecs(): Partial<Record<EventGroup, ModuleInitSpec>> {
    return {
      ...super.moduleSpecs,
      [EventGroup.Wirelane]: { moduleToken: 'wirelaneIntegrationModule' },
    };
  }

  /** The Wirelane API runs with the other APIs (`APP_NAME` `all`, `modules` or `api`). */
  protected override get apiSpecs(): Partial<Record<EventGroup, ApiInitSpec>> {
    const specs = super.apiSpecs;
    return {
      ...specs,
      [EventGroup.Api]: {
        apiTokens: [...(specs[EventGroup.Api]?.apiTokens ?? []), 'wirelaneApi'],
      },
    };
  }

  protected override registerAdditionalServices(container: AwilixContainer): void {
    super.registerAdditionalServices(container);
    registerWirelaneServices(container);
  }
}
