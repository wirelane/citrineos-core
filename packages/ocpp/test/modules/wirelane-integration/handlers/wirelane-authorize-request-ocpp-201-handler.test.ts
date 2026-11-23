// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID, type IMessage, type OCPP2_request_types } from '@citrineos/base';
import {
  EventGroup,
  MessageOrigin,
  MessageState,
  OCPP_CallAction,
  OCPPVersion,
} from '@citrineos/types';
import { AS_HANDLER_CLASS_METADATA } from '@interfaces/handlers/AsHandlerClass.js';
import {
  AuthorizeRequestOcpp201Handler,
  WirelaneAuthorizeRequestOcpp201Handler,
} from '@handlers/index.js';
import {
  createTestContainer,
  getTestInstance,
  makeMockOcppSender,
  type MockOcppSender,
} from '@test/testContainer.js';

function makeMessage(idToken: {
  idToken: string;
  type: string;
}): IMessage<OCPP2_request_types.AuthorizeRequest> {
  return {
    context: {
      tenantId: DEFAULT_TENANT_ID,
      ocppConnectionName: 'TEST001',
      correlationId: 'corr-001',
      timestamp: new Date().toISOString(),
    },
    payload: { idToken },
    origin: MessageOrigin.ChargingStationManagementSystem,
    eventGroup: EventGroup.Wirelane,
    action: OCPP_CallAction.Authorize,
    state: MessageState.Request,
    protocol: OCPPVersion.OCPP2_0_1,
  } as unknown as IMessage<OCPP2_request_types.AuthorizeRequest>;
}

describe('WirelaneAuthorizeRequestOcpp201Handler', () => {
  const { container, logger } = createTestContainer();
  let ocppSender: MockOcppSender;
  let authorizationRepository: { readOnlyOneByQuerystring: ReturnType<typeof vi.fn> };
  let wirelaneAuthorizationClient: {
    isEnabled: ReturnType<typeof vi.fn>;
    authorize: ReturnType<typeof vi.fn>;
  };

  function createHandler<T extends typeof AuthorizeRequestOcpp201Handler>(handlerClass: T) {
    return getTestInstance(
      container,
      handlerClass as typeof WirelaneAuthorizeRequestOcpp201Handler,
      {
        ocppSender: ocppSender as any,
        certificateAuthorityService: {} as any,
        authorizers: [],
        // The token is unknown to CitrineOS: upstream answers Unknown.
        authorizationRepository: authorizationRepository as any,
        deviceModelRepository: { readAllByQuerystring: vi.fn().mockResolvedValue([]) } as any,
        wirelaneAuthorizationClient: wirelaneAuthorizationClient as any,
      },
    );
  }

  function sentStatus(): string {
    expect(ocppSender.sendCallResultWithMessage).toHaveBeenCalledTimes(1);
    return ocppSender.sendCallResultWithMessage.mock.calls[0][1].idTokenInfo.status;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ocppSender = makeMockOcppSender();
    authorizationRepository = { readOnlyOneByQuerystring: vi.fn().mockResolvedValue(null) };
    wirelaneAuthorizationClient = {
      isEnabled: vi.fn().mockReturnValue(true),
      authorize: vi.fn().mockResolvedValue({ status: 'Accepted' }),
    };
  });

  it('answers an unknown token with the Accepted decision of ocpp-adapter', async () => {
    await createHandler(WirelaneAuthorizeRequestOcpp201Handler).handle(
      makeMessage({ idToken: '04A2B3C4', type: 'ISO14443' }),
    );

    expect(wirelaneAuthorizationClient.authorize).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      stationId: 'TEST001',
      protocol: 'ocpp2.0.1',
      trigger: 'Authorize',
      idToken: '04A2B3C4',
      idTokenType: 'ISO14443',
    });
    // Authorize carries no timestamp; none is invented.
    expect(wirelaneAuthorizationClient.authorize.mock.calls[0][0]).not.toHaveProperty('timestamp');
    expect(ocppSender.sendCallResultWithMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: OCPP_CallAction.Authorize }),
      {
        idTokenInfo: {
          status: 'Accepted',
          groupIdToken: { idToken: '04A2B3C4', type: 'ISO14443' },
        },
      },
    );
  });

  it('upstream answers the same unknown token with Unknown', async () => {
    // Pins the difference the Wirelane handler makes; see the test above.
    await createHandler(AuthorizeRequestOcpp201Handler).handle(
      makeMessage({ idToken: '04A2B3C4', type: 'ISO14443' }),
    );

    expect(sentStatus()).toBe('Unknown');
  });

  it('passes cacheExpiryDateTime of the decision on to the station', async () => {
    wirelaneAuthorizationClient.authorize.mockResolvedValueOnce({
      status: 'Accepted',
      cacheExpiryDateTime: '2026-10-29T12:00:00Z',
    });

    await createHandler(WirelaneAuthorizeRequestOcpp201Handler).handle(
      makeMessage({ idToken: '04A2B3C4', type: 'ISO14443' }),
    );

    expect(ocppSender.sendCallResultWithMessage.mock.calls[0][1]).toEqual({
      idTokenInfo: {
        status: 'Accepted',
        cacheExpiryDateTime: '2026-10-29T12:00:00Z',
        groupIdToken: { idToken: '04A2B3C4', type: 'ISO14443' },
      },
    });
  });

  it('answers Invalid when ocpp-adapter says Invalid', async () => {
    wirelaneAuthorizationClient.authorize.mockResolvedValueOnce({ status: 'Invalid' });

    await createHandler(WirelaneAuthorizeRequestOcpp201Handler).handle(
      makeMessage({ idToken: '04A2B3C4', type: 'ISO14443' }),
    );

    expect(ocppSender.sendCallResultWithMessage.mock.calls[0][1]).toEqual({
      idTokenInfo: { status: 'Invalid' },
    });
  });

  it('groups an accepted Central token by itself, like any accepted token', async () => {
    await createHandler(WirelaneAuthorizeRequestOcpp201Handler).handle(
      makeMessage({ idToken: 'a1b2c3d4-remote-start', type: 'Central' }),
    );

    expect(ocppSender.sendCallResultWithMessage.mock.calls[0][1]).toEqual({
      idTokenInfo: {
        status: 'Accepted',
        groupIdToken: { idToken: 'a1b2c3d4-remote-start', type: 'Central' },
      },
    });
  });

  it('accepts NoAuthorization without asking ocpp-adapter', async () => {
    await createHandler(WirelaneAuthorizeRequestOcpp201Handler).handle(
      makeMessage({ idToken: '', type: 'NoAuthorization' }),
    );

    expect(wirelaneAuthorizationClient.authorize).not.toHaveBeenCalled();
    expect(ocppSender.sendCallResultWithMessage.mock.calls[0][1]).toEqual({
      idTokenInfo: { status: 'Accepted' },
    });
  });

  it('answers a malformed ISO14443 token with a CallError without asking ocpp-adapter', async () => {
    await createHandler(WirelaneAuthorizeRequestOcpp201Handler).handle(
      makeMessage({ idToken: 'not-hex', type: 'ISO14443' }),
    );

    expect(wirelaneAuthorizationClient.authorize).not.toHaveBeenCalled();
    expect(ocppSender.sendCallErrorWithMessage).toHaveBeenCalledTimes(1);
    expect(ocppSender.sendCallResultWithMessage).not.toHaveBeenCalled();
  });

  it('falls back to upstream local authorization when remote authorization is disabled', async () => {
    wirelaneAuthorizationClient.isEnabled.mockReturnValue(false);

    await createHandler(WirelaneAuthorizeRequestOcpp201Handler).handle(
      makeMessage({ idToken: '04A2B3C4', type: 'ISO14443' }),
    );

    expect(wirelaneAuthorizationClient.authorize).not.toHaveBeenCalled();
    expect(authorizationRepository.readOnlyOneByQuerystring).toHaveBeenCalled();
    expect(sentStatus()).toBe('Unknown');
  });

  it('never logs the plain id token', async () => {
    await createHandler(WirelaneAuthorizeRequestOcpp201Handler).handle(
      makeMessage({ idToken: '04A2B3C4D5E6F7', type: 'ISO14443' }),
    );

    const logged = JSON.stringify(
      [logger.debug, logger.info, logger.warn, logger.error].flatMap((log) => log.mock.calls),
    );
    expect(logger.info).toHaveBeenCalled();
    expect(logged).not.toContain('04A2B3C4D5E6F7');
    expect(logged).toContain('04**********F7');
  });

  describe('handler metadata', () => {
    it('upstream handler declares exactly 2.0.1 Authorize', () => {
      expect(
        Reflect.getMetadata(AS_HANDLER_CLASS_METADATA, AuthorizeRequestOcpp201Handler),
      ).toEqual([{ action: 'Authorize', protocol: 'ocpp2.0.1', type: MessageState.Request }]);
    });

    it('the Wirelane handler resolves the same 2.0.1 Authorize declaration', () => {
      expect(
        Reflect.getMetadata(AS_HANDLER_CLASS_METADATA, WirelaneAuthorizeRequestOcpp201Handler),
      ).toEqual([{ action: 'Authorize', protocol: 'ocpp2.0.1', type: MessageState.Request }]);
    });
  });
});
