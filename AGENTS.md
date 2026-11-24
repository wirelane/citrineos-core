<!--
SPDX-FileCopyrightText: 2026 Wirelane GmbH

SPDX-License-Identifier: Apache-2.0
-->

# AGENTS.md — citrineos (Wirelane fork)

Wirelane fork of the open-source CitrineOS CSMS (TypeScript/Node, pnpm monorepo, vitest). Runs on staging only. General workflow rules are in the root `ai-base/AGENTS.md`; this file covers what is specific to this repo. Upstream's own rules for agents are kept in [Contributing to upstream](#contributing-to-upstream) below and apply only to contributions to `citrineos/citrineos-core`. `CLAUDE.md` is upstream's file and only imports this one.

## Fork layout

- GitHub `wirelane/citrineos-core` is the source of truth; merged work shows up as "Merge pull request #N from wirelane/…". The GitLab project `wirelane/emc/citrineos` is a pull mirror (see the comment in `.gitlab-ci.yml`) whose pipeline only builds the Docker image (`apps/ocpp-server/deploy.Dockerfile`) and offers manual staging deploy jobs. The unit tests run in GitHub Actions (`.github/workflows/unit-tests.yml`, workflow `Tests`: `pnpm install`, `pnpm run build`, `pnpm run test:coverage` with 75 % thresholds over `packages/{base,dal,ocpp,ocpi}/src` and `apps/mock-msp/src`).
- GitHub Actions on the fork: Publish Swagger, the three Push Release Tagged workflows and Renew Certificates are disabled. Upstream's PR-moderation workflows are disabled on the fork too, because they close or comment on our PRs: `Close AI SLOP Pull Requests` (`close-ai-slop-prs.yml`), `Label Conflicted Pull Requests` (`label-conflicted-prs.yml`, also closes long-conflicted PRs), `Close Stale Changes-Requested Pull Requests` (`close-stale-changes-requested.yml`) and `Greet First-Time Contributors` (`greet-first-time-contributor.yml`). Never edit or delete these workflow files; that only causes merge conflicts. `Require Migration`, `Dependency Catalog` and `Mock eMSP` are checks and may stay enabled. No check is required on `development`. `Tests` (`tests` job) is the one to check on a PR. `Linter` and `Test Server on Pull Request` can fail on files no PR has to touch (SWPROD-9662); a PR only has to keep them from naming its own files. Fork-only files such as `.gitlab-ci.yml` need an SPDX header, or `REUSE License Check` fails.
- Branches: `development` is the default and base branch and carries our changes; work goes there through PRs from `feature/…`/`bugfix/…`. `main` mirrors upstream `citrineos/citrineos-core:main` and has no commits of ours: it is only fast-forwarded (`gh repo sync wirelane/citrineos-core -b main` or "Sync fork", admins only). Fixes meant for upstream go on `upstream-fix/…` branches from `main`, with the PR against `citrineos/citrineos-core`.
- Upstream is integrated by merging `main` into `development` through a PR (merge commit, never rebase), so open PRs and tags keep their history. Our release tags go on `development` with a suffix, e.g. `v1.4.0-wl.1`.
- The GitLab mirror builds every branch; the manual staging deploy jobs run for `development` and `feature/…`/`bugfix/…` branches (`.gitlab-ci.yml`).
- **Keep Wirelane changes in Wirelane-owned files.** Upstream files are touched only at: the `wirelane` block in `packages/types/src/config/types.ts`, `EventGroup.Wirelane` in `packages/types/src/interfaces/messages/internal-types.ts`, the export line `@modules/wirelane-integration/index.js` in `packages/ocpp/index.ts`, and `WirelaneCitrineOSServer` in `apps/ocpp-server/src/index.ts`. Every other upstream change becomes a merge conflict later; ask before adding a touch point.

## Where Wirelane code lives

Everything is in `packages/ocpp/src/modules/wirelane-integration/`, tests in `packages/ocpp/test/modules/wirelane-integration/`. It has to live inside `packages/ocpp`: `TransactionService` and the handlers are not exported from the package.

- `wirelane-citrineos-server.ts`: `WirelaneCitrineOSServer extends CitrineOSServer`, started by `apps/ocpp-server/src/index.ts`. Adds the module to `moduleSpecs` (`EventGroup.Wirelane` → `wirelaneIntegrationModule`), `wirelaneApi` to the `api` group of `apiSpecs`, and calls `registerWirelaneServices` in `registerAdditionalServices`. That hook runs after `buildContainer()`, so its registrations replace the upstream ones of the same token.
- `register.ts`: `WIRELANE_HANDLERS` and `registerWirelaneServices` (module, services, API, and the overrides of `transactionService`, `webhookDispatcher` and `evDriverHandlers`).
- `module.ts` (`WirelaneIntegrationModule`, event group `wirelane`), `handlers/` (BootNotification 1.6/2.x observers, `WirelaneAuthorizeRequestOcpp201Handler`), `station-discovery-notifier.ts`, `wirelane-authorization-client.ts`, `wirelane-transaction-service.ts`, `wirelane-webhook-dispatcher.ts`, `wirelane-api.ts` and `active-transaction-endpoint.ts`.
- Wirelane files use kebab-case names like upstream and carry the header `SPDX-FileCopyrightText: 2026 Wirelane GmbH` / `SPDX-License-Identifier: Apache-2.0`.
- Calls to ocpp-adapter use `fetch` with `AbortSignal.timeout(...)` against `wirelane.ocppAdapterBaseUrl` and log failures instead of throwing.

## Config

- The server config comes only from environment variables, parsed by `configSchema` (`packages/types/src/config/types.ts`, `ConfigLoader.loadConfig`): `CITRINEOS_<PATH>`, one segment per underscore, matched case-insensitively, values `JSON.parse`d with the plain string as fallback. A variable naming an unknown key is only logged and ignored. Websocket servers come from the file `websocketServerConfigFile` (default `websocket-servers.json`) in `fileAccess`.
- Wirelane keys (top-level `wirelane` block): `CITRINEOS_WIRELANE_OCPPADAPTERBASEURL`, `CITRINEOS_WIRELANE_OCPPADAPTERWEBHOOKURL` (informational, not read), `CITRINEOS_WIRELANE_REMOTEAUTHORIZATION_ENABLED` (default `true`), `CITRINEOS_WIRELANE_REMOTEAUTHORIZATION_TIMEOUTMS` (default `18000`). The staging values are set in infrastructure-cdk (`citrine-os-stack.ts`).
- Tests and the other packages read `@citrineos/types` from `packages/types/dist` (vitest has no source alias for it). After changing the schema, rebuild it (`pnpm --filter @citrineos/types run build`), or tests and type checks still see the old schema.

## How handlers and modules route messages

- A module subscribes to exactly the actions its handlers declare with `@AsRequestHandler`/`@AsResponseHandler` (`AbstractModule` constructor). The request queue is `rabbit_queue_<eventGroup>_requests` (`module-receiver.ts`).
- Two handlers for the same protocol/action **in one module** fail the module start. The same action in **two modules** is not detected: both modules subscribe, and both would answer the charger.
- **Stale queue bindings:** a module queue (`durable` + `autoDelete`) gets one header binding per subscribed action and never loses one: `_subscribePerIdentifierQueue` only binds. With a rolling ECS deployment the queue is never consumer-less and `autoDelete` never fires. **Moving an action between modules therefore needs a manual step on each environment:** scale the service to 0 before deploying (the queues are recreated clean), or delete the old binding in CloudAMQP afterwards, and check the bindings there. Otherwise both modules answer the action, the router keeps the first CallResult and logs `Failed to send callResult due to missing message id` for the other.
- **Decorator trap:** `AsHandlerClass` (`packages/base/src/interfaces/handlers/as-handler-class.ts`) pushes onto whatever `Reflect.getMetadata` returns, and that lookup walks the prototype chain, so a decorated subclass of a decorated handler pushes onto the **parent's** array. Subclass an upstream handler **without** a decorator; it inherits the parent's declaration (`WirelaneAuthorizeRequestOcpp201Handler`).

## OCPP 2.0.1 authorization via ocpp-adapter

Controlled by `wirelane.remoteAuthorization` (`enabled`, `timeoutMs`). `timeoutMs` must stay below `timeouts.maxCallLengthSeconds` (20 s) with room for the router's own queueing: the router drops a CallResult once the station's call has left its cache. ocpp-adapter's CSG timeout and lock waits are budgeted against it. Both hooks ask `WirelaneAuthorizationClient`, which calls `POST {ocppAdapterBaseUrl}/internal/authorizations` with `{csms, tenantId, stationId, protocol, trigger: Authorize|TransactionEvent, idToken, idTokenType, evseId?, connectorId?, transactionId?, eventType?, timestamp?}` and maps every failure to Invalid. `timestamp` is sent only for TransactionEvent: the event's own timestamp as the station sent it. `NoAuthorization` is accepted locally without a call. An Accepted decision carries `groupIdToken` = the presented token, like ocpp-server's `parentIdTag` = idTag, so a station lets only the same card stop the transaction; Invalid and NoAuthorization carry none. With the flag off, both hooks fall back to upstream local authorization. That is an emergency switch, not a normal mode: ocpp-adapter pushes a transaction whose token needs authorization to charging-session-gateway only once it is linked to an accepted authorization from this endpoint, so while the flag is off, RFID sessions are not billed.

1. **Authorize:** the Wirelane module answers Authorize for every protocol: `WirelaneAuthorizeRequestOcpp201Handler` for 2.0.1, the upstream 1.6 and 2.1 handlers unchanged. `registerWirelaneServices` replaces `evDriverHandlers` with the upstream list minus its three Authorize handlers: it re-registers the original resolver as `upstreamEvDriverHandlers` and filters its result, and the start fails if that does not remove exactly three. So the Wirelane module must run wherever EVDriver runs, or nobody answers Authorize. The delegated 2.0.1 path ignores ISO 15118 certificate data (`certificate`, `iso15118CertificateHashData`); the flag-off fallback goes through upstream's certificate checks.
2. **TransactionEvent:** `transactionService` is replaced by `WirelaneTransactionService`, which overrides only `authorizeOcpp201IdToken`.

## Subscriptions and the ocpp-adapter API

- ocpp-adapter subscribes to a station's frames with upstream's `POST /ocpprouter/subscription` after the BootNotification discovery. The dispatcher keeps an already known station's subscriptions in memory until its 3-minute refresh, so `StationDiscoveryNotifier` calls `WirelaneWebhookDispatcher.reloadSubscriptions` after the discovery POST. That works because the dispatcher is an in-process singleton shared by the Wirelane module and the messages module, which holds on staging (`APP_NAME=all`).
- `GET /wirelane/transactions/activeTransaction?ocppConnectionName=&evseId=&tenantId=` (tenant defaults to 1) answers `{"transactionId": "…"}` for the active transaction on that EVSE, 404 if there is none, 400 without station or EVSE. Its permission (`commandPermissionName`) is not in upstream's permission catalog, so with `auth.mode=jwt` it needs a role grant; staging runs `localBypass`.

## Upstream-merge checklist

On every merge of `main` (upstream) into `development`:

- Check that `git ls-files packages/core` is empty and that nothing of ours sits outside `wirelane-integration` and the touch points above. Wirelane files left in a directory upstream moved or dropped from the workspace still build and pass, but no longer run.
- Diff `AuthorizeRequestOcpp201Handler.handle` and its private `_sendAuthorizeResult` (`packages/ocpp/src/handlers/requests/2/authorize-request-ocpp-201-handler.ts`). `WirelaneAuthorizeRequestOcpp201Handler` replicates the token validation, the NoAuthorization shortcut and the send step, and does not inherit changes to them.
- Diff `TransactionService.authorizeOcpp201IdToken` (`packages/ocpp/src/modules/transactions/transaction-service.ts`). `WirelaneTransactionService` does not inherit changes there either.
- Check that EVDriver's handler list (`packages/ocpp/src/modules/ev-driver/register.ts`) still has exactly the three Authorize handlers (the server test and the start fail otherwise), that `AsHandlerClass` still behaves as described above, and that `CitrineOSServer` still calls `registerAdditionalServices` after `buildContainer()`.
- Check that `WebhookDispatcher` still keeps a known station's subscriptions in memory (`_identifiers`, `_loadSubscriptionsForConnection`) and that `webhookDispatcher` is still a singleton in `registerMessagesServices`.
- Build, run the Wirelane suites, and check the staging env vars against the new `configSchema`.

## Build, lint, test

- Node from `.nvmrc`, pnpm 10.19.0 (`packageManager`). Without a global pnpm: `npx -y pnpm@10.19.0 <cmd>`.
- `pnpm install`, then `pnpm --filter "@citrineos/ocpp-server..." run build`. Lint per package from its directory (`cd packages/ocpp && npx eslint <files>`; `apps/ocpp-server` needs `--config config/eslint.config.js`), and `npx prettier --check <files>`.
- Tests run from the repo root through `vitest.config.ts` (projects `ocpp`, `dal`, `base`, …, with type checking): `npx vitest run --project ocpp packages/ocpp/test/modules/wirelane-integration`. `apps/ocpp-server` is not a vitest project. `pnpm test` includes testcontainers suites that need Docker.
- Unit tests build classes with `createTestContainer()`/`getTestInstance()` from `packages/ocpp/test/test-container.ts`, mount endpoints with `mountEndpoint` (`test/providers/endpoint-harness.ts`), and mock `fetch` by assigning `global.fetch`.

## Contributing to upstream

Upstream's rules from its `AGENTS.md`, condensed. They apply to `upstream-fix/…` branches and PRs against `citrineos/citrineos-core` only, not to work on `development`, where the ai-base workflow rules apply.

- Do not commit, push or open a PR unless your user asked for it. Audit the diff three times (does what was asked; reasonable solution; breaks nothing) and let the user review it before the PR.
- A human writes the PR title and summary. An agent-written PR carries **AI SLOP** and 🤖🤖🤖 in title and description, and upstream closes it. Bug fixes carry exact reproduction steps; spec-driven changes cite PDF, page and the quoted requirement.
- Never comment, reply to reviews or resolve threads upstream; bring feedback to the user. At most five open PRs; a PR with conflicts unresolved for three weeks gets closed.
- Code rules: SPDX header `Contributors to the CitrineOS Project`; do not hand-edit the generated schemas under `packages/types/src/ocpp/model`; a DB shape change needs a migration in `apps/ocpp-server/db/migrations`; shared dependency versions live in the `catalog:` of `pnpm-workspace.yaml`; handlers and endpoints only run once added to their list (`packages/ocpp/src/handlers/HANDLERS.md`); path aliases live in both `vitest.config.ts` and `tsconfig.test.base.json`; no `as any`/`as unknown as`, `@ts-ignore` or `eslint-disable`; comments only where code is non-obvious; take protocol versions from the data in shared code.
- Do not bend our data to fit an external API, do not compensate for senders that break the spec, and do not paper over a cause with a workaround; report it instead.
- Verify with `pnpm build`, `pnpm test` (with Docker), `pnpm lint`, prettier on your files, and a stack run with a simulated charger (`pnpm citrine --local --everest`).
