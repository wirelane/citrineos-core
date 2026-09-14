// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { DEFAULT_TENANT_ID, QuerySchema } from '@citrineos/base';

export interface ActiveTransactionQuerystring {
  ocppConnectionName: string;
  evseId: number;
  tenantId: number;
}

export const ActiveTransactionQuerySchema = QuerySchema('ActiveTransactionQuerySchema', [
  {
    key: 'ocppConnectionName',
    type: 'string',
    required: true,
  },
  {
    key: 'evseId',
    type: 'number',
    required: true,
  },
  {
    key: 'tenantId',
    type: 'number',
    required: true,
    defaultValue: String(DEFAULT_TENANT_ID),
  },
]);
