# UniConf Architecture Document

> One-stop proxy configuration management tool  
> **Manage once, export everywhere.**

## Project Overview

UniConf is a full-stack web application that allows users to manage proxy subscriptions, nodes, filtering rules, strategy groups, and traffic routing rules in one place, then export complete configuration files for different proxy clients (Mihomo/Clash, sing-box, Loon, etc.).

---

## Monorepo Structure

```
uni-conf/
├── apps/
│   ├── web/                    # Vite 8 + React 19 SPA (Cloudflare Pages)
│   └── worker/                 # Hono + D1 API (Cloudflare Workers)
├── packages/
│   └── types/                  # Shared TypeScript type definitions
├── docs/
│   ├── ARCHITECTURE.md         # This file
│   ├── DATA_MODEL.md           # DB schema and data flow
│   ├── EXPORTER_GUIDE.md       # How to add a new exporter
│   └── CONTRIBUTING.md         # Development guide
├── pnpm-workspace.yaml
├── package.json
└── .prettierrc
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19 + Vite 8 + TypeScript | SPA user interface |
| State | Zustand 5 | Client-side state management |
| Router | React Router v7 | SPA routing |
| Styling | Vanilla CSS + CSS Modules | Component styles with CSS variables |
| i18n | i18next + react-i18next | Bilingual zh/en support |
| Drag & Drop | @dnd-kit | Rule reordering |
| Code Highlight | Shiki | Config file preview display; generated content comes from Worker export APIs |
| UI Primitives | Radix UI | Accessible component primitives |
| Backend | Hono 4 + Cloudflare Workers | REST API |
| Database | Cloudflare D1 (SQLite) | Persistent data storage |
| KV Store | Cloudflare KV | Token mapping, caching |
| YAML | js-yaml | Clash/Mihomo YAML generation |
| Tests | Vitest + React Testing Library | Unit and component tests |
| Deploy | Cloudflare Pages + Workers | Edge deployment |

---

## Database Migrations

`apps/worker/migrations/0001_initial_schema.sql` is the canonical fresh-install schema. Later migration files may still exist to preserve the historical migration order, but they must not re-add columns already present in `0001`; repeated `ALTER TABLE ... ADD COLUMN` statements break a new D1 database when migrations are applied from scratch. If a later migration's schema change has been folded into `0001`, keep that migration as a no-op or data backfill only, and verify a fresh SQLite/D1 database can apply every file in lexical order. `0019_normalize_zero_setup_foundations.sql` is the final static normalization for built-in policy groups and the default usable node pool, matching what the runtime zero-setup sync also enforces. `apps/worker/src/db/migrations.test.ts` rejects later `ADD COLUMN` statements for columns already declared by the initial schema and checks that the foundation normalization keeps the managed default pool and global node outlets present.

---

## Deployment Architecture

```
User Browser
     │
     ▼
Cloudflare Pages (SPA)
apps/web/dist/
     │
     │ /api/* → proxied to Worker
     │ /sub/* → proxied to Worker
     ▼
Cloudflare Workers
apps/worker/
     │
     ├── D1 Database (SQLite)
     │   All persistent data
     │
     └── KV Namespace
         Token → export config mapping
         Source content cache
```

In production, configure Cloudflare Pages to proxy `/api/*` and `/sub/*` to the Worker using Pages' built-in routing or Worker routing.

In development:
- Frontend: `pnpm dev` → http://localhost:5173
- Worker: `pnpm dev:worker` → http://localhost:8787
- Vite proxy config forwards `/api` and `/sub` to port 8787

---

## API Design

All API endpoints are under `/api/`. Responses follow:

```ts
// Success
{ success: true, data: T }

// Error
{ success: false, error: string }
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| GET/POST | /api/sources | List/create sources |
| GET/PUT/DELETE | /api/sources/:id | Get/update/delete source |
| POST | /api/sources/:id/refresh | Fetch and parse subscription URL |
| GET/POST | /api/nodes | List/create nodes |
| GET/PUT/DELETE | /api/nodes/:id | Get/update/delete node |
| GET/POST | /api/collections | List/create collections |
| GET/PUT/DELETE | /api/collections/:id | Get/update/delete collection |
| GET | /api/collections/:id/preview | Preview filtered nodes |
| GET/POST | /api/groups | List/create groups |
| GET/PUT/DELETE | /api/groups/:id | Get/update/delete group |
| POST | /api/groups/reorder | Reorder groups |
| GET/POST | /api/rules | List/create rules |
| GET/PUT/DELETE | /api/rules/:id | Get/update/delete rule |
| POST | /api/rules/reorder | Reorder rules |
| POST | /api/rules/batch | Batch create manual rules |
| GET/POST | /api/export/configs | List/create export configs |
| GET/PUT/DELETE | /api/export/configs/:id | Get/update/delete export config |
| GET | /api/export/preview/:format | Generate and validate config preview in Worker (auth required) |
| GET | /api/export/download/:format | Download config (auth required) |
| GET | /sub/:token/:filename | Public subscription endpoint |

### Public Subscription URLs

```
/sub/{token}/mihomo.yaml
/sub/{token}/singbox.json
/sub/{token}/loon.conf
/sub/{token}/nodes.txt
```

---

## Data Flow

### Subscription Refresh

```
1. User adds subscription URL from Dashboard or Sources page
2. Backend refreshes URL sources during creation when refreshAfterCreate is enabled
3. User can also click "Refresh" manually
4. Worker scheduled handler runs every 5 minutes and refreshes due URL sources when auto refresh is enabled
5. Worker fetches the external URL (server-side, no CORS issue)
6. Auto-detects format (Clash YAML / sing-box JSON / Base64 / raw URI lines / etc.)
7. Parses nodes and upstream proxy groups from content
8. Filters subscription-info pseudo nodes, non-mainstream protocols, and nodes missing protocol-required fields
9. Upserts nodes into D1 nodes table and stores raw source content
10. Regenerates country/region auto node groups
11. Updates source.node_count and source.last_updated, and clears source.last_refresh_error
12. On refresh failure, stores source.last_refresh_error for source status display
13. Returns { success, nodeCount, addedCount, updatedCount, removedCount, excludedCount }
```

### Config Export

```
1. User configures export in Export page
2. Worker generates export token, stores in export_configs table
3. User shares /sub/{token}/mihomo.yaml URL
4. External client fetches that URL
5. Worker looks up export config by token
6. Fetches nodes, groups, rules from D1
7. Applies collection filters/renames/sorting (in-memory)
8. Generates complete config via appropriate generator
9. Returns with proper Content-Type header
```

---

## Frontend Architecture

```
src/
├── app/
│   ├── App.tsx              # Root: RouterProvider + i18n init + theme
│   └── router.tsx           # Route definitions
├── pages/                   # Page components
│   ├── Dashboard/
│   ├── Sources/
│   ├── Nodes/
│   ├── Collections/
│   ├── Groups/
│   ├── Rules/
│   ├── Export/
│   ├── Preview/
│   └── Settings/
├── components/
│   ├── ui/                  # Reusable primitives
│   │   ├── Button/
│   │   ├── Input/
│   │   ├── Modal/
│   │   ├── Badge/
│   │   ├── Card/
│   │   ├── Select/
│   │   ├── Switch/
│   │   ├── Toast/
│   │   ├── EmptyState/
│   │   └── Spinner/
│   └── layout/
│       ├── Sidebar/
│       ├── Layout/
│       └── PageHeader/
├── store/                   # Zustand stores
│   ├── sources.store.ts
│   ├── nodes.store.ts
│   ├── collections.store.ts
│   ├── groups.store.ts
│   ├── rules.store.ts
│   └── settings.store.ts
├── core/                    # Pure business logic (testable)
│   ├── parser/              # Subscription format parsers
│   ├── filter/              # Node filtering/renaming/sorting
│   ├── remote-rules/        # UI wrappers around shared remote rule set presets
│   └── compatibility/       # UI wrappers around shared client compatibility data
├── lib/
│   └── api.ts               # Typed API client
├── i18n/
│   ├── index.ts             # i18next setup
│   ├── zh.json              # Chinese translations
│   └── en.json              # English translations
├── hooks/                   # Custom React hooks
├── types/                   # Additional frontend-only types
├── test/
│   └── setup.ts             # Test setup
├── index.css                # Global styles + CSS variables
└── main.tsx                 # Entry point
```

---

## Theming System

CSS variables in `index.css` define the design tokens:

```css
:root {
  --color-bg: #f4f4f7;
  --color-surface: #ffffff;
  --color-border: #e0e0e8;
  --color-accent: #7c3aed;
  /* ... */
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0d0d12;
    --color-surface: #16161f;
    --color-border: #2a2a3a;
    /* ... */
  }
}

[data-theme="dark"] { /* dark overrides */ }
[data-theme="light"] { /* light overrides */ }
```

Theme preference stored in settings store, applied to `document.documentElement`.

---

## Adding a New Exporter

See [EXPORTER_GUIDE.md](./EXPORTER_GUIDE.md) for detailed instructions.

Quick summary:
1. Add the format to `ExportFormat` in `packages/types/src/index.ts`
2. Add subscription filename mapping in `packages/shared/src/index.ts` when applicable
3. Add or extend a generator in `apps/worker/src/generators/`
4. Wire worker preview, download, and public subscription routes
5. Add shared compatibility metadata and UI labels
6. Add worker generator and preview validation tests

---

## Testing Strategy

| Layer | Tool | Coverage Target |
|-------|------|----------------|
| Core parsers | Vitest | ≥ 90% |
| Worker generators | Vitest (snapshot/structural) | ≥ 85% |
| Core filters | Vitest | ≥ 90% |
| UI components | React Testing Library | Key interactions |
| Worker routes | @cloudflare/vitest-pool-workers | ≥ 80% |

Run tests:
```bash
pnpm test                    # All tests
pnpm --filter web test       # Frontend only
pnpm --filter worker test    # Worker only
pnpm test:coverage           # With coverage
```

---

## Environment Variables

### Frontend (apps/web/.env.local)
```
VITE_API_URL=/api
```

### Worker (apps/worker/.dev.vars)
```
ENVIRONMENT=development
API_KEY=your-optional-admin-key
```

### Production
Configure in Cloudflare Dashboard:
- Worker env vars: `ENVIRONMENT=production`
- D1 binding: `DB` → your D1 database
- KV binding: `KV` → your KV namespace
