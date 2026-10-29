// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import {
  type IMessage,
  type OCPP2_request_types,
  type OCPP2_response_types,
  OcppError,
  recordAuthorizeResult,
} from '@citrineos/base';
import {
  AuthorizationStatusEnum,
  ErrorCode,
  type HandlerProperties,
  IdTokenEnum,
  type OCPP2_0_1,
} from '@citrineos/types';
import { validateIdToken } from '@/util/index.js';
import { AuthorizeRequestOcpp201Handler } from './AuthorizeRequestOcpp201Handler.js';
import type { WirelaneAuthorizationClient } from '@modules/WirelaneIntegration/src/module/WirelaneAuthorizationClient.js';

type UpstreamDependencies = ConstructorParameters<typeof AuthorizeRequestOcpp201Handler>[0];

/**
 * Answers OCPP 2.0.1 Authorize with the decision of ocpp-adapter (and thereby
 * charging-session-gateway) when `modules.wirelane.remoteAuthorization.enabled` is set, and
 * falls back to the upstream local authorization otherwise.
 *
 * Deliberately NOT decorated with `@AsRequestHandler`: the decorator reaches the parent's
 * metadata array through the prototype chain and pushes onto it, so everything declared here
 * would also be declared by the upstream handler. Without a decorator this class inherits the
 * parent's `[2.0.1 Authorize]` declaration.
 *
 * Upstream merge: diff {@link AuthorizeRequestOcpp201Handler.handle} on every upstream merge;
 * the delegated path does not inherit changes to it.
 */
export class WirelaneAuthorizeRequestOcpp201Handler extends AuthorizeRequestOcpp201Handler {
  private readonly _wirelaneAuthorizationClient: WirelaneAuthorizationClient;

  constructor(
    dependencies: UpstreamDependencies & {
      wirelaneAuthorizationClient: WirelaneAuthorizationClient;
    },
  ) {
    super(dependencies);
    this._wirelaneAuthorizationClient = dependencies.wirelaneAuthorizationClient;
  }

  async handle(
    message: IMessage<OCPP2_request_types.AuthorizeRequest>,
    props?: HandlerProperties,
  ): Promise<void> {
    if (!this._wirelaneAuthorizationClient.isEnabled()) {
      return super.handle(message, props);
    }

    this._logger.info(
      this.createHandlerReceivedMessageLog('Wirelane AuthorizeRequest'),
      message,
      props,
    );

    const idToken = (message.payload as OCPP2_0_1.AuthorizeRequest).idToken;
    const tokenValidation = validateIdToken(idToken.type, idToken.idToken);
    if (!tokenValidation.isValid) {
      this._logger.warn('Invalid ID token format', {
        type: idToken.type,
        error: tokenValidation.errorMessage,
      });
      await this._ocppSender.sendCallErrorWithMessage(
        message,
        new OcppError(
          message.context.correlationId,
          ErrorCode.PropertyConstraintViolation,
          tokenValidation.errorMessage || 'Invalid token value for specified type',
        ),
      );
      return;
    }

    let response: OCPP2_response_types.AuthorizeResponse;
    if (idToken.type === IdTokenEnum.NoAuthorization) {
      response = {
        idTokenInfo: { status: AuthorizationStatusEnum.Accepted },
      } as OCPP2_response_types.AuthorizeResponse;
    } else {
      const decision = await this._wirelaneAuthorizationClient.authorize({
        tenantId: message.context.tenantId,
        stationId: message.context.ocppConnectionName,
        protocol: String(message.protocol),
        trigger: 'Authorize',
        idToken: idToken.idToken,
        idTokenType: idToken.type,
      });
      response = {
        idTokenInfo: {
          status:
            decision.status === 'Accepted'
              ? AuthorizationStatusEnum.Accepted
              : AuthorizationStatusEnum.Invalid,
          ...(decision.cacheExpiryDateTime
            ? { cacheExpiryDateTime: decision.cacheExpiryDateTime }
            : {}),
        },
      } as OCPP2_response_types.AuthorizeResponse;
    }

    // Same as the parent's private _sendAuthorizeResult: record the metric, then answer.
    recordAuthorizeResult({
      status: response.idTokenInfo.status,
      ocppVersion: String(message.protocol),
      action: 'Authorize',
    });
    const messageConfirmation = await this._ocppSender.sendCallResultWithMessage(message, response);
    this._logger.debug(this.createHandlerSentMessageLog('AuthorizeResponse'), messageConfirmation);
  }
}
