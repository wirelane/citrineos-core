// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import {
  AbstractEndpoint,
  type AbstractEndpointDependencies,
  DEFAULT_TENANT_ID,
  type ICommandEndpointMetadata,
  QuerySchema,
} from '@citrineos/base';
import { HttpMethod } from '@citrineos/types';
import type { ITransactionRepository } from '@citrineos/dal';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface ActiveTransactionQuerystring {
  ocppConnectionName: string;
  evseId: number;
  tenantId: number;
}

export const ActiveTransactionQuerySchema = QuerySchema('WirelaneActiveTransactionQuerySchema', [
  { key: 'ocppConnectionName', type: 'string', required: true },
  { key: 'evseId', type: 'integer', required: true },
  { key: 'tenantId', type: 'integer', required: true, defaultValue: String(DEFAULT_TENANT_ID) },
]);

export interface ActiveTransactionResponse {
  transactionId: string;
}

type ActiveTransactionRoute = { Querystring: ActiveTransactionQuerystring };

/**
 * The id of the active transaction on a station's EVSE, for ocpp-adapter, which knows only the
 * station and EVSE when it has to stop a transaction. Answers 404 when there is none.
 */
export class ActiveTransactionEndpoint extends AbstractEndpoint<ActiveTransactionRoute> {
  static readonly route: ICommandEndpointMetadata = {
    method: HttpMethod.Get,
    path: '/transactions/activeTransaction',
    querySchema: ActiveTransactionQuerySchema,
    responseSchema: {
      type: 'object',
      properties: { transactionId: { type: 'string' } },
      required: ['transactionId'],
    },
  };

  private readonly _transactionRepository: ITransactionRepository;

  constructor({
    logger,
    transactionRepository,
  }: AbstractEndpointDependencies & { transactionRepository: ITransactionRepository }) {
    super(logger);
    this._transactionRepository = transactionRepository;
  }

  async handle(
    request: FastifyRequest<ActiveTransactionRoute>,
    reply: FastifyReply,
  ): Promise<ActiveTransactionResponse | { message: string }> {
    const { tenantId, ocppConnectionName, evseId } = request.query;
    const transaction = await this._transactionRepository.getActiveTransactionByStationIdAndEvseId(
      tenantId,
      ocppConnectionName,
      evseId,
    );
    if (!transaction) {
      // Answered directly: a thrown error is logged as ERROR, and no active transaction is normal.
      reply.code(404);
      return {
        message: `No active transaction on EVSE ${evseId} of station ${ocppConnectionName}`,
      };
    }
    return { transactionId: transaction.transactionId };
  }
}
