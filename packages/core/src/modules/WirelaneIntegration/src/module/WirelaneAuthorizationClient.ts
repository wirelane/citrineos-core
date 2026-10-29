// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import type { BootstrapConfig } from '@citrineos/base';
import type { SystemConfig } from '@citrineos/types';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';

export const DEFAULT_REMOTE_AUTHORIZATION_TIMEOUT_MS = 17_000;

export type WirelaneAuthorizationTrigger = 'Authorize' | 'TransactionEvent';

export type WirelaneAuthorizationStatus = 'Accepted' | 'Invalid';

/**
 * What the caller knows about the token. `csms` is added by the client.
 */
export type WirelaneAuthorizationRequest = {
  tenantId: number;
  stationId: string;
  protocol: string;
  trigger: WirelaneAuthorizationTrigger;
  idToken: string;
  idTokenType: string;
  evseId?: number;
  connectorId?: number;
  transactionId?: string;
  eventType?: string;
};

export type WirelaneAuthorizationDecision = {
  status: WirelaneAuthorizationStatus;
  cacheExpiryDateTime?: string;
};

export interface WirelaneAuthorizationClientDependencies {
  config: BootstrapConfig & SystemConfig;
  logger?: Logger<ILogObj>;
}

const INVALID: WirelaneAuthorizationDecision = { status: 'Invalid' };

/**
 * Asks ocpp-adapter (`POST {ocppAdapterBaseUrl}/internal/authorizations`) whether an id token
 * may charge. ocpp-adapter in turn asks charging-session-gateway.
 *
 * Never throws: every failure (no base URL, timeout, network error, non-2xx, unparsable body,
 * unknown status) is logged and answered with Invalid, so a charger is never left without a
 * response and an unchecked token never charges.
 */
export class WirelaneAuthorizationClient {
  private readonly _logger: Logger<ILogObj>;
  private readonly _adapterBaseUrl?: string;
  private readonly _enabled: boolean;
  private readonly _timeoutMs: number;

  constructor({ config, logger }: WirelaneAuthorizationClientDependencies) {
    this._logger = logger
      ? logger.getSubLogger({ name: this.constructor.name })
      : new Logger<ILogObj>({ name: this.constructor.name });
    const wirelane = config.modules.wirelane;
    this._adapterBaseUrl = wirelane?.ocppAdapterBaseUrl;
    this._enabled = wirelane?.remoteAuthorization?.enabled ?? false;
    this._timeoutMs =
      wirelane?.remoteAuthorization?.timeoutMs ?? DEFAULT_REMOTE_AUTHORIZATION_TIMEOUT_MS;
  }

  /**
   * Whether OCPP 2.0.1 authorization is delegated to ocpp-adapter
   * (`modules.wirelane.remoteAuthorization.enabled`).
   */
  isEnabled(): boolean {
    return this._enabled;
  }

  async authorize(request: WirelaneAuthorizationRequest): Promise<WirelaneAuthorizationDecision> {
    const logContext = {
      stationId: request.stationId,
      trigger: request.trigger,
      idTokenType: request.idTokenType,
      idToken: maskIdToken(request.idToken),
      transactionId: request.transactionId,
    };

    const baseUrl = this._adapterBaseUrl;
    if (!baseUrl) {
      this._logger.error(
        'Rejecting id token: modules.wirelane.ocppAdapterBaseUrl is not set',
        logContext,
      );
      return INVALID;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/internal/authorizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csms: 'citrineos', ...request }),
        signal: AbortSignal.timeout(this._timeoutMs),
      });
    } catch (error) {
      this._logger.error('ocpp-adapter authorization request failed', { ...logContext, error });
      return INVALID;
    }

    if (response.status !== 200) {
      const errorText = await response.text().catch(() => '');
      this._logger.error('ocpp-adapter authorization request returned an error', {
        ...logContext,
        status: response.status,
        errorText,
      });
      return INVALID;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      this._logger.error('ocpp-adapter authorization response is not valid JSON', {
        ...logContext,
        error,
      });
      return INVALID;
    }

    const decision = toDecision(body);
    if (!decision) {
      this._logger.error('ocpp-adapter authorization response has an unknown shape', {
        ...logContext,
        body,
      });
      return INVALID;
    }

    this._logger.info('ocpp-adapter authorization decision', {
      ...logContext,
      status: decision.status,
      cacheExpiryDateTime: decision.cacheExpiryDateTime,
    });
    return decision;
  }
}

function toDecision(body: unknown): WirelaneAuthorizationDecision | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const { status, cacheExpiryDateTime } = body as Record<string, unknown>;
  if (status !== 'Accepted' && status !== 'Invalid') {
    return undefined;
  }
  return typeof cacheExpiryDateTime === 'string' ? { status, cacheExpiryDateTime } : { status };
}

/**
 * Keeps the first and last two characters of a token, so log lines can be correlated without
 * revealing the token. Tokens of four characters or fewer are masked completely.
 */
export function maskIdToken(idToken: string): string {
  if (idToken.length <= 4) {
    return '*'.repeat(idToken.length);
  }
  return `${idToken.slice(0, 2)}${'*'.repeat(idToken.length - 4)}${idToken.slice(-2)}`;
}
