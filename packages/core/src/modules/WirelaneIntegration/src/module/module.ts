// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import type { CallAction, OcppModuleDependencies } from '@citrineos/base';
import { AbstractModule, EventGroup } from '@citrineos/base';

export class WirelaneIntegrationModule extends AbstractModule {
  _requests: CallAction[] = [];
  _responses: CallAction[] = [];

  constructor({
    config,
    cache,
    sender,
    handler,
    logger,
    ocppValidator,
  }: OcppModuleDependencies) {
    super(config, cache, handler, sender, EventGroup.Wirelane, logger, ocppValidator);
    this._requests = [];
    this._responses = [];
  }
}

export default WirelaneIntegrationModule;
