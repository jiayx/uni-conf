# Contributing to UniConf

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 10
- Cloudflare account (for deployment)

## Local Development Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Create local Worker env vars
cp apps/worker/.env.example apps/worker/.env
# Edit apps/worker/.env with your settings

# 3. Initialize local D1 database
pnpm --filter worker db:migrate:local

# 4. Start worker (in one terminal)
pnpm dev:worker

# 5. Start frontend (in another terminal)
pnpm dev
```

Frontend: http://localhost:5173  
Worker API: http://localhost:8787  
Vite proxy automatically forwards `/api/*` and `/sub/*` to the worker.

## Project Structure

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full architecture overview.

## Running Tests

```bash
pnpm test              # Run all tests
pnpm test:coverage     # Run with coverage report
pnpm --filter web test # Frontend tests only
pnpm --filter worker test # Worker tests only
```

Coverage is enforced in CI. Worker coverage includes routes, services, and generators (global 80% statements/lines, 90% functions, 65% branches). Web coverage includes application wiring, shared components, core logic, API clients, every page, and all stores. Its current ratchet is 50% statements/lines, 40% functions/branches, with stricter per-directory floors for core, lib, and store code. Raise thresholds with new tests; do not narrow the include globs to make a gate pass.

## Code Style

- TypeScript strict mode (no `any`, no implicit `any`)
- No default exports for non-component modules
- CSS Modules for component styles
- i18n for all user-facing strings (no hardcoded text in components)
- All new features need tests

## Git Workflow

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make changes with tests
3. Run `pnpm lint && pnpm typecheck && pnpm test`
4. Commit and open a PR

## Deployment

### Cloudflare Setup

1. Create a D1 database:
   ```bash
   wrangler d1 create uni-conf-db
   ```

2. Create a KV namespace:
   ```bash
   wrangler kv namespace create KV
   ```

3. Update both `staging` and `production` entries in `apps/worker/wrangler.jsonc` with real D1/KV IDs and allowed origins.

4. Follow [OPERATIONS.md](./OPERATIONS.md): deploy to staging, run the smoke test, then approve production and apply migrations before code deployment.
   ```bash
   pnpm --filter worker db:migrate
   ```

5. Deploy worker:
   ```bash
   pnpm --filter worker deploy
   ```

6. Build frontend assets and deploy the Worker:
   ```bash
   pnpm build
   pnpm --filter worker deploy
   ```

### Environment Variables

Worker production env vars (set in Cloudflare Dashboard):
- `ENVIRONMENT=production`
- `API_KEY=<your-admin-api-key>` (required in production; `/api/*` fails closed when it is missing)
- `ALLOWED_ORIGIN=https://your-pages-domain.example` (recommended)

Frontend env:
- `VITE_API_URL=/api` is the default same-origin path and can usually be omitted.
- Set `VITE_API_URL=https://api.example.com/api` only if the SPA is served from a separate origin.

## Adding Features

### New Proxy Protocol Support
1. Sync protocol metadata in `packages/types/src/protocols.ts` from the upstream sing-box/mihomo schema sources.
2. Add URI compatibility parsing in `apps/web/src/core/parser/proxy-link.parser.ts` only when the protocol has a share-link format.
3. Prefer native mihomo/sing-box config objects in `rawConfig`; keep `parsedConfig` limited to searchable/display fields.
4. Add explicit client conversion only when a lossless or well-understood mapping exists.

After changing protocol metadata or upgrading schema packages, run:

```bash
pnpm --filter @uni-conf/types generate:protocols
pnpm --filter @uni-conf/types check:protocols
```

`pnpm --filter @uni-conf/types typecheck` and root `pnpm typecheck` also run the protocol metadata check, so registry/schema drift is caught in the normal validation path.

### New Export Format
See [EXPORTER_GUIDE.md](./EXPORTER_GUIDE.md).

When adding or changing a client export format, update the shared rule and remote-rule-set compatibility matrices in `@uni-conf/shared` first, then wire the worker generator and web UI through those shared helpers. Do not add a second local compatibility table in a page or generator.

### New Default Rule
Default routing should prefer remote rule set presets in `@uni-conf/shared` and `apps/worker/src/services/default-rule-sets.ts`. Do not add worker-owned local rule templates; manual rules are user-created overrides for cases that cannot reasonably live in a remote rule set.

## Debugging

### Worker logs
```bash
wrangler tail --format=pretty
```

### D1 queries
```bash
wrangler d1 execute DB --command="SELECT * FROM sources LIMIT 10"
```

### Frontend build analysis
```bash
pnpm --filter web build -- --analyze
```
