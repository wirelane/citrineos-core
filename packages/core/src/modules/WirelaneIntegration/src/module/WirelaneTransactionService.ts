// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import type { IMessageContext, OCPP2_request_types, OCPP2_response_types } from '@citrineos/base';
import { IdTokenEnum, OCPP2_0_1, OCPPVersion } from '@citrineos/types';
import { TransactionService } from '@modules/Transactions/src/module/TransactionService.js';
import type { WirelaneAuthorizationClient } from './WirelaneAuthorizationClient.js';

type UpstreamDependencies = ConstructorParameters<typeof TransactionService>[0];

/**
 * Replaces the Transactions module's `transactionService` (see `registerWirelaneServices`) so
 * the id token of an OCPP 2.0.1 TransactionEvent is authorized by ocpp-adapter when
 * `modules.wirelane.remoteAuthorization.enabled` is set.
 *
 * Only {@link TransactionService.authorizeOcpp201IdToken} is overridden. The delegated path
 * deliberately skips the upstream authorization-row lookup, the ConcurrentTx check, the location
 * lookup and the upstream authorizers: ocpp-adapter / charging-session-gateway decide instead.
 * The OCPP 1.6 and 2.1 methods keep the upstream behaviour.
 *
 * Upstream merge: diff {@link TransactionService.authorizeOcpp201IdToken} on every upstream
 * merge; the delegated path does not inherit changes to it.
 */
export class WirelaneTransactionService extends TransactionService {
  private readonly _wirelaneAuthorizationClient: WirelaneAuthorizationClient;

  constructor(
    dependencies: UpstreamDependencies & {
      wirelaneAuthorizationClient: WirelaneAuthorizationClient;
    },
  ) {
    super(dependencies);
    this._wirelaneAuthorizationClient = dependencies.wirelaneAuthorizationClient;
  }

  async authorizeOcpp201IdToken(
    tenantId: number,
    transactionEvent: OCPP2_request_types.TransactionEventRequest,
    messageContext: IMessageContext,
  ): Promise<OCPP2_response_types.TransactionEventResponse> {
    if (!this._wirelaneAuthorizationClient.isEnabled()) {
      return super.authorizeOcpp201IdToken(tenantId, transactionEvent, messageContext);
    }

    const idToken = transactionEvent.idToken!;
    if (idToken.type === IdTokenEnum.NoAuthorization) {
      return { idTokenInfo: { status: OCPP2_0_1.AuthorizationStatusEnumType.Accepted } };
    }

    // Only called for OCPP 2.0.1: TransactionEventRequestOcpp2Handler calls the 2.1 variant
    // for OCPP 2.1, and this method has no access to the message protocol.
    const decision = await this._wirelaneAuthorizationClient.authorize({
      tenantId,
      stationId: messageContext.ocppConnectionName,
      protocol: OCPPVersion.OCPP2_0_1,
      trigger: 'TransactionEvent',
      idToken: idToken.idToken,
      idTokenType: idToken.type,
      evseId: transactionEvent.evse?.id,
      connectorId: transactionEvent.evse?.connectorId ?? undefined,
      transactionId: transactionEvent.transactionInfo.transactionId,
      eventType: transactionEvent.eventType,
    });

    const idTokenInfo: OCPP2_0_1.IdTokenInfoType = {
      status:
        decision.status === 'Accepted'
          ? OCPP2_0_1.AuthorizationStatusEnumType.Accepted
          : OCPP2_0_1.AuthorizationStatusEnumType.Invalid,
    };
    if (decision.cacheExpiryDateTime) {
      idTokenInfo.cacheExpiryDateTime = decision.cacheExpiryDateTime;
    }
    return { idTokenInfo };
  }
}
