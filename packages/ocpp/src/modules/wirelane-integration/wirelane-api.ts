// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { AbstractEndpointApi, type BuiltEndpoint } from '@citrineos/base';
import type { FastifyInstance } from 'fastify';
import type { ILogObj, Logger } from 'tslog';

export const WIRELANE_ENDPOINT_PREFIX = '/wirelane';

/** HTTP endpoints for ocpp-adapter, served under {@link WIRELANE_ENDPOINT_PREFIX}. */
export class WirelaneApi extends AbstractEndpointApi {
  constructor({
    server,
    wirelaneEndpoints,
    logger,
  }: {
    server: FastifyInstance;
    wirelaneEndpoints: BuiltEndpoint[];
    logger?: Logger<ILogObj>;
  }) {
    super(server, WIRELANE_ENDPOINT_PREFIX, wirelaneEndpoints, logger);
  }
}
