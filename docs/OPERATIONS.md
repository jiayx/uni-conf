# Operations and Release Runbook

## Supported operating model

UniConf v1 is a single-administrator, self-hosted service. Protect the admin API with `API_KEY`, restrict browser access with `ALLOWED_ORIGIN`, and treat export tokens and backups as secrets. Backups contain node credentials in plaintext by design so they can restore the instance.

## Environments and required configuration

`apps/worker/wrangler.jsonc` contains separate local, staging, and production bindings. Before the first remote deployment, replace every `REPLACE_WITH_*` value and configure these GitHub environments:

| Setting | Staging | Production |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` secret | required | required |
| `CLOUDFLARE_ACCOUNT_ID` secret | required | required |
| `API_KEY` secret | required | required |
| `UNICONF_BASE_URL` variable | required | required |
| D1 and KV IDs in Wrangler | required | required |
| `ALLOWED_ORIGIN` in Wrangler | exact public origin | exact public origin |

Keep GitHub environment approval enabled for production. The deploy workflow deliberately applies D1 migrations before the Worker and stops when any placeholder remains.

## Release procedure

1. Run `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`.
2. Export a backup from Settings before a schema-changing release.
3. Dispatch the `Deploy` workflow to `staging`.
4. Confirm the automated smoke checks for `/api/health`, the SPA root, and authenticated `/api/auth/check`.
5. Manually import a representative config and download at least Mihomo and sing-box output after schema or generator changes.
6. Approve and dispatch production only after staging passes.

Use `pnpm smoke` locally against a deployed target by setting `UNICONF_BASE_URL` and optionally `UNICONF_API_KEY`.

## Rollback and recovery

Worker code and assets can be rolled back to the previous Cloudflare deployment. D1 migrations must remain forward-compatible: do not remove or rename a column in the same release that stops using it. For a data rollback, deploy compatible code first, validate the backup through `/api/data/import/validate`, then restore it from Settings. Never edit or replay an unvalidated backup directly against D1.

## Observability

Every non-test request emits one JSON log event named `http_request` containing request ID, method, path, response status, duration, and environment. The same request ID is returned as `X-Request-Id`; use it to correlate a browser failure with Worker logs. Unhandled failures emit `worker_error`, while scheduled refreshes emit `source_auto_refresh` with checked, refreshed, failed, skipped, error, and duration fields.

Recommended alerts:

- any production `worker_error`;
- five-minute HTTP 5xx rate above 1%;
- p95 admin API latency above 1 second or subscription generation above 3 seconds;
- any scheduled refresh failure for three consecutive cron runs;
- smoke-test failure after deployment.

Do not log authorization headers, export tokens, source raw content, node credentials, or backup bodies.

## Capacity baseline

The parser regression suite covers a 10,000-node raw subscription. Import/restore is capped at 100,000 rows per table and request bodies at 25 MiB. Scheduled source refreshes use bounded concurrency of four to avoid serial backlog without creating unbounded outbound traffic or D1 writes. For larger installations, measure Worker CPU time, D1 row counts, generated payload size, and cron duration in staging before raising these limits.

## Import semantics

Import is preview-first. Nodes and source groups are parsed for all supported source formats. Clash/Mihomo manual rules and HTTP rule providers are structurally migrated only after confirmation and only when their target group can be resolved safely. Unsupported or unmapped rules, DNS, and client-specific settings remain in the source's original config and are reported in the preview; they are never silently reinterpreted.
