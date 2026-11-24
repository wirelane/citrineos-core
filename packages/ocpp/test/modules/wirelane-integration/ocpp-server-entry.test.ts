// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

const { CitrineOSServer, WirelaneCitrineOSServer, loadConfig } = vi.hoisted(() => {
  const aServer = () => ({ run: vi.fn().mockResolvedValue(undefined) });
  return {
    CitrineOSServer: vi.fn(aServer),
    WirelaneCitrineOSServer: vi.fn(aServer),
    loadConfig: vi.fn().mockResolvedValue({ marker: 'config' }),
  };
});

vi.mock('@citrineos/ocpp', () => ({ CitrineOSServer, WirelaneCitrineOSServer }));
vi.mock('@citrineos/base', () => ({ ConfigLoader: { loadConfig } }));

describe('apps/ocpp-server entry point', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('starts WirelaneCitrineOSServer, not the plain CitrineOSServer', async () => {
    vi.stubEnv('APP_NAME', 'ALL');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await import('../../../../../apps/ocpp-server/src/index.js');

    await vi.waitFor(() => expect(WirelaneCitrineOSServer).toHaveBeenCalled());
    expect(WirelaneCitrineOSServer).toHaveBeenCalledWith('all', { marker: 'config' });
    expect(CitrineOSServer).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
