<!--
SPDX-FileCopyrightText: 2026 Wirelane GmbH

SPDX-License-Identifier: Apache-2.0
-->

# AGENTS.md — citrineos (Wirelane fork)

Wirelane fork of the open-source CitrineOS CSMS (TypeScript/Node, pnpm monorepo, vitest). Runs on staging only. General workflow rules are in the root `ai-base/AGENTS.md`; this file only covers what is specific to this repo.

## Fork layout

- GitHub `wirelane/citrineos-core` is the source of truth; merged work shows up as "Merge pull request #N from wirelane/…". The GitLab project `wirelane/emc/citrineos` is a pull mirror (see the comment in `.gitlab-ci.yml`) whose pipeline only builds the Docker image (`apps/ocpp-server/deploy.Dockerfile`) and offers manual staging deploy jobs. The unit tests run in GitHub Actions (`.github/workflows/unit-tests.yml`: `pnpm install`, `pnpm run build`, `pnpm test`).
- Base branch is `main`. Upstream is merged in with merge commits (`Merge remote-tracking branch 'upstream/main'`).
- **Keep Wirelane changes in Wirelane-owned files.** Upstream files are changed only where there is no other way: the config schema (`packages/types/src/config/types.ts`, `wirelane` block), the env configs and the handler exports in `packages/core/src/handlers/index.ts`. Every other upstream change becomes a merge conflict later.

## Where Wirelane code lives

- `packages/core/src/modules/WirelaneIntegration/src/`: the `WirelaneIntegrationModule` (event group `wirelane`), `register.ts` (`registerWirelaneServices`: handler list, services, overrides) and the services under `module/`: `StationDiscoveryNotifier`, `WirelaneAuthorizationClient`, `WirelaneTransactionService`.
- `packages/core/src/handlers/requests/{1.6,2}/Wirelane*.ts`: Wirelane handlers, exported from `packages/core/src/handlers/index.ts`.
- Tests: `packages/core/test/modules/WirelaneIntegration/` and `packages/core/test/handlers/requests/{1.6,2}/Wirelane*.test.ts`.
- Wirelane files carry the header `SPDX-FileCopyrightText: 2026 Wirelane GmbH` / `SPDX-License-Identifier: Apache-2.0`.
- Calls to ocpp-adapter use `fetch` with `AbortSignal.timeout(...)` against `modules.wirelane.ocppAdapterBaseUrl` and log failures instead of throwing.

## Config

- Staging runs `apps/ocpp-server/src/config/envs/docker.ts`; the config is rebuilt from it on every start. `local.ts` is the local equivalent.
- Environment variables override single keys: `CITRINEOS_modules_wirelane_remoteAuthorization_enabled=false`. Path segments match config keys case-insensitively, and values are `JSON.parse`d (so `false` is a boolean), falling back to the plain string (`packages/base/src/config/defineConfig.ts`).
- A new config key goes into **both** schemas in `packages/types/src/config/types.ts`: the input schema (`systemConfigInputSchema`, carries the defaults) and the strict `systemConfigSchema`. A key only in the input schema is stripped by the strict parse and is missing from the `SystemConfig` type.
- `@citrineos/core` reads the types from `packages/types/dist`. After changing the schema, rebuild it (`pnpm --filter @citrineos/types run build`) before type-checking core, or tsc reports the new key as missing.

## How handlers and modules route messages

- A module subscribes to exactly the actions its handlers declare with `@AsRequestHandler`/`@AsResponseHandler` (`AbstractModule` constructor), minus `modules.<module>.excludedRequests`/`excludedResponses`. The `requests`/`responses` lists in the env configs are not read for routing.
- Two handlers for the same protocol/action **in one module** fail the module start. The same action in **two modules** is not detected: both modules subscribe, and both would answer the charger.
- **Decorator trap:** `AsHandlerClass` stores the declarations as an array in `reflect-metadata` and pushes onto whatever `getMetadata` returns. That lookup walks the prototype chain, so a decorated subclass of a decorated handler pushes onto the **parent's** array: the upstream handler then also declares whatever the subclass declares (the same action twice is not caught by the module, because both entries point at one instance). Subclass an upstream handler **without** a decorator; it inherits the parent's declaration (`WirelaneAuthorizeRequestOcpp201Handler`).

## OCPP 2.0.1 authorization via ocpp-adapter

Controlled by `modules.wirelane.remoteAuthorization` (`enabled`, `timeoutMs`). Both hooks ask `WirelaneAuthorizationClient`, which calls `POST {ocppAdapterBaseUrl}/internal/authorizations` with `{csms, tenantId, stationId, protocol, trigger: Authorize|TransactionEvent, idToken, idTokenType, evseId?, connectorId?, transactionId?, eventType?, timestamp?}` and maps every failure to Invalid. `timestamp` is sent only for TransactionEvent: it is the event's own timestamp, passed through as the station sent it (it differs from now for events the station queued while offline). `NoAuthorization` is accepted locally without a call. An Accepted decision carries `groupIdToken` = the presented token (`{idToken, type}`), like ocpp-server's `parentIdTag` = idTag, so a station lets only the same card stop the transaction; Invalid and NoAuthorization carry none. With the flag off, both hooks fall back to upstream behaviour.

1. **Authorize:** `docker.ts`/`local.ts` put `Authorize` into `modules.evdriver.excludedRequests`. Only then does `selectWirelaneHandlerClasses` (`register.ts`) add the Authorize handlers to the Wirelane module: the upstream 1.6 and 2.1 handlers unchanged, and `WirelaneAuthorizeRequestOcpp201Handler` for 2.0.1. Without the exclusion it adds none and warns if the flag is on, so Authorize is never answered twice. With the exclusion, the Wirelane module must run, or nobody answers Authorize. `apps/ocpp-server/test/config/docker.test.ts` pins both settings for staging.
2. **TransactionEvent:** `registerWirelaneServices` re-registers the `transactionService` token as `WirelaneTransactionService`, which overrides only `authorizeOcpp201IdToken`. This relies on `registerWirelaneServices` running **after** `registerTransactionsServices` in `registerModuleServices` (`apps/ocpp-server/src/container.ts`); Awilix keeps the last registration. Do not reorder those calls.

## Upstream-merge checklist

On every merge of `upstream/main`:

- Diff `AuthorizeRequestOcpp201Handler.handle` and its private `_sendAuthorizeResult` (`packages/core/src/handlers/requests/2/`). `WirelaneAuthorizeRequestOcpp201Handler` replicates the token validation, the NoAuthorization shortcut and the send step, and does not inherit changes to them.
- Diff `TransactionService.authorizeOcpp201IdToken` (`packages/core/src/modules/Transactions/src/module/`). `WirelaneTransactionService` does not inherit changes there either.
- Check that the EVDriver handler list (`packages/core/src/modules/EVDriver/src/register.ts`) still has the three Authorize handlers that `WIRELANE_AUTHORIZE_HANDLERS` mirrors, that `AsHandlerClass` still behaves as described above, and that `registerModuleServices` still calls `registerWirelaneServices` last.

## Build, lint, test

- Node from `.nvmrc`, pnpm 10.19.0 (`packageManager`). Without a global pnpm: `npx -y pnpm@10.19.0 <cmd>`.
- `pnpm install`, then build the server and its workspace dependencies with `pnpm --filter "@citrineos/ocpp-server..." run build`. The plain `pnpm run build` also builds operator-ui and the OCPI apps.
- Lint: `pnpm --filter "@citrineos/ocpp-server..." run lint` (eslint with prettier rules).
- Tests run from the repo root through `vitest.config.ts`, which maps the path aliases (`@handlers`, `@modules`, `@test`, …) to source: `npx vitest run packages/core/test/modules/WirelaneIntegration`. `apps/ocpp-server` has no test script of its own; its tests under `apps/ocpp-server/test/` run through the same root config. `pnpm test` runs everything, including testcontainers-based integration suites that need Docker.
- Unit tests build classes with `createTestContainer()`/`getTestInstance()` from `packages/core/test/testContainer.ts`, and mock `fetch` by assigning `global.fetch`.
