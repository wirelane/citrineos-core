// SPDX-FileCopyrightText: 2026 Wirelane GmbH
//
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createDockerConfig } from '../../src/config/envs/docker.js';

/**
 * Staging runs this config. Authorize must be answered by exactly one module: EVDriver hands it
 * over through excludedRequests, and the Wirelane module (which then carries the Authorize
 * handlers) must be configured, with remote authorization on.
 */
describe('createDockerConfig', () => {
  const config = createDockerConfig();

  it('hands Authorize over from EVDriver', () => {
    expect(config.modules.evdriver.excludedRequests).toContain('Authorize');
  });

  it('runs the Wirelane module with remote authorization enabled', () => {
    expect(config.modules.wirelane).toBeDefined();
    expect(config.modules.wirelane?.remoteAuthorization?.enabled).toBe(true);
  });
});
