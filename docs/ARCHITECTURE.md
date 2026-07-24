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
│   ├── web/                    # Vite 8 + React 19 SPA (Worker Static Assets)
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
| Frontend | React 19 + Vite 8 + TypeScript 7 | SPA user interface |
| State | Zustand 5 | Client-side state management |
| Router | React Router v8 | SPA routing |
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
| Deploy | Cloudflare Workers + Static Assets | Edge deployment |

---

## Database Migrations

`apps/worker/migrations/0001_initial_schema.sql` is the only migration and defines the complete current schema, indexes, settings, and managed zero-setup data. The repository intentionally carries no incremental upgrade history or compatibility columns. Schema changes are folded directly into this baseline and verified against an empty SQLite/D1 database.

This is a clean-install migration policy: an existing D1 database whose migration ledger already contains `0001_initial_schema.sql` must not be upgraded in place. Export a current-version backup first, recreate the D1 database (or create a replacement binding), apply the baseline, and restore the validated backup. Backups from earlier schema versions are rejected rather than normalized implicitly.

---

## Deployment Architecture

```
User Browser
     │
     ▼
Cloudflare Workers
apps/worker/
     │
     ├── Static Assets
     │   apps/web/dist/
     │
     ├── Worker API
     │   /api/* and /sub/* run worker code before asset fallback
     │
     ├── D1 Database (SQLite)
     │   All persistent data, including export token lookups
     │
     └── KV Namespace
         Caches remote rule-set URL reachability checks used by the
         config preview endpoint (1h TTL). The public /sub/* response
         itself is intentionally not cached - it sends
         Cache-Control: no-store so toggling a source/node/rule is
         reflected on the client's very next refresh.
```

In production, the Worker serves the SPA through Workers Static Assets. `apps/worker/wrangler.jsonc` uses `run_worker_first` for `/api/*` and `/sub/*`, so API and public subscription routes run in the Worker before static asset fallback.

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

### Authentication

`/api/*` (except `/api/health` and `/api/ready`) requires a shared bearer token when the `API_KEY` secret is configured: `Authorization: Bearer <API_KEY>`. Leaving `API_KEY` unset keeps the API open, which is only acceptable for local development — production deployments should set it with `wrangler secret put API_KEY`. `GET /api/auth/check` is a lightweight endpoint the frontend uses to verify a stored key; it returns `{ success: true, data: { ok: true } }` when authorized and `401` otherwise. CORS is restricted to `ALLOWED_ORIGIN` when set, and falls back to `*` otherwise (dev-only). The public `/sub/:token/*` endpoint is unaffected — it is protected by its own per-export token instead. `GET /api/ready` exposes only boolean dependency/configuration checks and never returns secret values.

The token-scoped `/sub/:token/rules/:ruleSetId/:filename` endpoint is part of the same export-policy boundary as its parent subscription. It reloads the enabled profile and global settings, resolves the profile override, and rejects cached or freshly converted artifacts with any skipped rules when the effective policy is `strict`. A strict rejection is a non-cacheable `409 conversion_incomplete`; compatible profiles still receive the safely preserved subset plus exact conversion/skip headers.

All Worker-initiated subscription and remote rule-set downloads use one guarded fetch path. It accepts only public HTTP(S) URLs without embedded credentials, rejects local/private/reserved literal addresses and local-only hostnames, manually validates every redirect target, removes credential headers across origins, enforces a redirect limit, and applies a request timeout. This covers manual refresh, scheduled refresh, rule-set content inspection, and export reachability checks. Wrangler enables Cloudflare's `global_fetch_strictly_public` compatibility flag as an additional egress boundary for DNS-resolved destinations and same-zone requests.

Config-source content has a shared 4 MiB UTF-8 limit. Clipboard/file preview and import validate the decoded string, retry endpoints validate stored legacy content, and URL refresh checks both declared length and streamed bytes before caching. The broader API body middleware remains a defense-in-depth request cap; the source-specific limit is the authoritative parser/memory boundary.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check (public, no auth) |
| GET | /api/ready | Dependency and production configuration readiness (public, no auth) |
| GET | /api/auth/check | Verify the bearer token is valid |
| GET | /api/dashboard/stats | Return dashboard object counts plus a current/stale/pending multi-source rule-set health summary |
| GET/POST | /api/sources | List/create sources |
| POST | /api/sources/import/preview | Parse imported content and return database-aware node/rule/rule-set differences without writing |
| POST | /api/sources/import | Import a source from pasted/uploaded config content (Clash/Mihomo YAML, sing-box JSON, raw URI lines) instead of a URL |
| GET | /api/sources/imports | List the latest non-sensitive import run summaries |
| POST | /api/sources/imports/:runId/nodes/preview | Rebuild a source-aware node preview for a retryable partial import |
| POST | /api/sources/imports/:runId/nodes/retry | Atomically retry only the failed node phase without importing rules again |
| POST | /api/sources/imports/:runId/structured/preview | Rebuild a database-aware rule/rule-set preview for a retryable partial import |
| POST | /api/sources/imports/:runId/structured/retry | Atomically retry only the failed structured phase without importing nodes again |
| POST | /api/sources/imports/:runId/undo | Atomically remove an imported source and its source-owned objects while retaining audit history |
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
| POST | /api/rules/batch | Atomically create up to 500 prevalidated manual rules |
| POST | /api/rules/reorder | Atomically apply an exact permutation of all manual rule IDs |
| GET/POST | /api/remote-rule-sets | List/create remote rule sets |
| GET/PUT/DELETE | /api/remote-rule-sets/:id | Get/update/delete a remote rule set; managed presets only accept enabled-state and target-native-source updates |
| POST | /api/remote-rule-sets/:id/validate | Download and validate remote rule-set content |
| POST | /api/remote-rule-sets/:id/validate-all | Validate the stored default source and every target-native override with bounded concurrency, then return aggregate health |
| POST | /api/remote-rule-sets/validate-pending | Check up to five enabled rule sets whose multi-source health is missing or stale; source downloads never exceed three concurrent requests |
| POST | /api/remote-rule-sets/validate-source | Validate an unsaved target-client-native source URL and its declared format |
| POST | /api/remote-rule-sets/validate-sources | Validate 1–9 unique target-native sources with bounded concurrency |
| POST | /api/remote-rule-sets/:id/conversion-preview | Classify direct/converted/unsupported compatibility and preview a safe conversion |
| GET/POST | /api/export/configs | List/create export configs |
| GET/PUT/DELETE | /api/export/configs/:id | Get/update/delete export config |
| GET | /api/export/preview/:format | Generate and validate config preview in Worker (auth required) |
| GET | /api/export/readiness/:format | Run the same checks without returning config content (auth required) |
| GET | /api/export/download/:format | Download config (auth required) |
| GET | /sub/:token/:filename | Public subscription endpoint |
| GET | /sub/:token/rules/:ruleSetId/:filename | Token-scoped converted rule-set endpoint |

`POST /api/sources/import` creates the source/history claim first. Parsed node inserts, updates, removals, and the source node-count/content summary are then committed in one D1 batch. It subsequently submits all newly planned manual rules, remote rule sets, and explicitly accepted conflict updates in a separate atomic D1 batch. Conflict updates use compare-and-set predicates, cannot overwrite managed or ambiguous objects, and record only non-sensitive before/applied routing fields for conditional undo. This prevents a node persistence failure from leaving a partially reconciled source while still preserving the successfully parsed node phase if the optional structured phase fails. The response distinguishes `refreshError` from `structuredImportError` so the UI can report partial success accurately.

Auto-format detection also recognizes Clash/Mihomo documents whose top level contains `rules` or `rule-providers` but no proxies. For a rules-only import, the source/raw-content phase records a successful zero-node result and the normal structured batch owns the imported rules and providers. The same source marker and history undo path are used, so this is not a separate persistence model.

When only the structured phase fails, the import history exposes a retry action. The Worker rebuilds the preview from the authenticated source's stored `raw_content`, accepts a fresh set of per-item conflict decisions, and runs only rules and remote rule sets. It claims the partial run before writing so duplicate submissions receive `409`; a successful retry clears `structured_error`, while a caught failure returns the run to `partial`. The node/source phase is never repeated.

When the node phase fails, history similarly offers a node-only preview and retry. The retry preview excludes nodes already owned by that source, so partially completed or previously successful rows are treated as idempotent source state rather than global duplicates. `new-only` still compares against every other source and manual node. The retry runs the same atomic node/source batch and never re-runs structured imports; if a structured error also remains, the history row stays `partial` and can proceed to the independent rule retry.

Import-history reads and actions first recover `running` rows whose latest lifecycle timestamp is more than ten minutes old. Stale initial imports become generic node-phase partial failures; stale structured retries keep their generic structured error and return to the retryable partial state. This repairs interrupted Worker executions without changing fresh in-flight operations or storing detailed exception text.

### Public Subscription URLs

```
/sub/{token}/mihomo.yaml
/sub/{token}/clash.yaml
/sub/{token}/singbox.json
/sub/{token}/loon.conf
/sub/{token}/surge.conf
/sub/{token}/shadowrocket.conf
/sub/{token}/quantumultx.conf
/sub/{token}/stash.yaml
/sub/{token}/egern.yaml
/sub/{token}/nodes.txt
/sub/{token}/nodes-raw.txt
```

### Remote Rule Set Content Validation

Content validation is an authenticated, explicit action from the routing-policy page. Stored default sources and unsaved target-native override URLs use the same endpoint policy and validator; the latter is inspected as the selected target client's native format before the form is saved. Operators can validate one override or all configured overrides in one request. Batch requests accept one unique source per supported target, cap the batch at nine, validate every input before starting downloads, preserve target order, and use a three-request concurrency ceiling. The Worker downloads at most 2 MiB per source with an 8-second timeout, rejects HTTP/HTML/encoding failures, and validates plain domain, IP CIDR, and classical-rule lists as well as YAML payloads and sing-box source JSON. For compiled sing-box SRS files it verifies the `SRS` container header and reports that individual rules were not inspected instead of claiming full semantic validation.

The editor can derive native-source candidates only for repository layouts registered by the application. The initial recognizer accepts exact HTTPS `github.com/QuixoticHeart/rule-set` and `raw.githubusercontent.com/QuixoticHeart/rule-set` rule-set branch paths and extracts a constrained rule-set identifier plus its actual source family. It never rewrites arbitrary hosts or unknown paths. Discovery is an explicit form action, fills only missing target entries whose native family differs from the detected default source, tracks which values it supplied, and removes only unchanged auto-supplied values if the default URL changes. Hand-entered or subsequently edited overrides remain untouched. Discovery validates the merged manual-and-derived source list immediately by default, using the same batch state machine and request IDs as a manual batch check; the operator can turn this off for a fill-only workflow. Changing the default URL invalidates pending discovery checks so a late response cannot restore stale health results.

Source-validation results remain transient editor state and are invalidated whenever the corresponding URL changes. A known invalid URL/input can never pass the editor's save guard. In `compatible` conversion mode, known content/download failures require an explicit per-edit acknowledgement; warning-only results do not. In `strict` mode, known failures block the editor save until the URL is fixed or removed. Normal API writes intentionally remain non-networked, so export/subscription preflight is still the authoritative enforcement point for direct API callers and for upstream failures that occur after saving.

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

An explicit remote-rule-set compatibility preview also refreshes conversion state. It bypasses the converted-artifact KV read, downloads current upstream content, and writes a successful result back to the shared cache. Subsequent readiness checks and client fetches therefore use the content the user just inspected.

Every conversion-preview result includes `checkedAt`, including direct and unsupported decisions. The Web UI keeps that timestamp attached to the last successful result during refresh and after a failed retry, so an explicitly stale result still communicates when it was generated.

The remote-rule-set form and compatibility-preview target selectors use explicit label associations rather than positional accessible names. Component tests query every primary selector by its visible label, preventing later layout changes from silently breaking keyboard or assistive-technology navigation.

The current exporter capability revision is 16. Revision 16 retains non-string YAML `payload` entries as invalid diagnostics instead of filtering them before strict completeness accounting. Its converted-rule-set cache namespace is v10 so older under-counted artifacts cannot survive the upgrade. Revision 15 added domain-regex and cached-artifact validation; revision 14 unified value-level network/protocol conversion; revision 13 normalized port ranges and sing-box range fields; revision 12 separated Clash, Stash, and Mihomo native-source resolution.

```
1. User configures export in Export page
2. Worker generates export token, stores in export_configs table
3. User shares /sub/{token}/mihomo.yaml URL
4. External client fetches that URL
5. Worker looks up export config by token
6. Fetches nodes, groups, rules from D1
7. Applies collection filters/renames/sorting (in-memory)
8. Reads the selected exporter's node-protocol, rule-set-container, output-kind, and managed-DNS support from `EXPORT_CLIENT_CAPABILITIES` in `@uni-conf/shared`. Backend readiness checks and the export editor use this same implementation registry, while contract tests verify that every advertised node protocol and sing-box manual-rule type still has a matching serializer. The registry carries an explicit revision: revision 2 narrowed Quantumult X to native `[server_local]` entries, revision 3 introduced a dedicated Surge serializer, revision 4 replaced guessed Loon fields with its documented positional node formats while adding SSR, VLESS, and Hysteria 2 and removing unverified AnyTLS, revision 5 aligned Egern with its native single-type-key YAML structure, revision 6 migrated sing-box TUN and WireGuard output to the stable 1.13 `address` and endpoint contracts, revision 7 replaced deprecated sing-box DNS outbound matching with `route.default_domain_resolver` plus explicit DNS route actions, revision 8 aligned sing-box source-IP/source-port/process/protocol/network rules while replacing removed legacy GeoIP fields with binary rule-set references, revision 9 introduced payload-aware manual-rule compatibility plus exact `PORT`, `NETWORK`, `PROTOCOL`, and source-IP spellings for Mihomo, sing-box, Surge, and Egern, revision 10 extended the same resolver to Loon, Shadowrocket, and Quantumult X, including Loon `DEST-PORT`/`IPASN`/protocol conversion, Shadowrocket `DST-PORT`, removal of the false Quantumult X port capability, and separation of manual `RULE-SET` directives from the native Loon/Quantumult X remote-resource sections, revision 11 makes Quantumult X `DOMAIN`/`DOMAIN-SUFFIX`/`DOMAIN-KEYWORD`/`IP-CIDR6`/`MATCH` spelling changes explicit equivalent conversions so readiness and transformation reports no longer hide them as unchanged rules, and revision 12 preserves distinct Clash, Stash, and Mihomo target-native rule-set sources across shared YAML generation and token-scoped conversion. Revision 17 aligns the sing-box 1.13.13 schema by removing SSR from that target while retaining WireGuard as a top-level endpoint. Preview/readiness APIs return `{ id, format, revision }`, and successful authenticated downloads, public subscriptions, and token-scoped converted rule sets emit `X-UniConf-Capability-Profile: uni-conf-exporter/{format}@{revision}`. This identifies the UniConf serializer contract used for an artifact without pretending to identify the downstream client's application version.

Compatibility warnings that describe an actual export mutation additionally carry a stable `code` and structured `transformation` payload. The payload identifies the affected resource kind, action (`convert`, `skip`, `degrade`, `omit-option`, `reorder`, or `block`), exact source and optional target representation, reason, and remote conversion counts where applicable. Remote rule-set preflight evaluates every selected conversion with bounded concurrency and retains stable source order even when an earlier item blocks strict delivery. It returns every blocking warning for readiness and every successful, degraded, or failed transformation for the report; the first blocker remains the deterministic summary used by download and public-subscription error responses. Conversion failures preserve the converter's stable category as `source-download-failed`, `source-too-large`, `source-invalid-content`, or `conversion-unexpected-failure`, allowing localized messages to recommend the correct recovery without exposing raw upstream or internal exceptions. Partial and failed conversions also attach `sourceOverrideTarget` to the structured remote-rule-set remediation. The frontend serializes it as `nativeSource`, consumes it with the entity `edit` parameter, expands the native-source editor, and focuses the exact target input while preserving unrelated query filters. Fully safe conversions intentionally omit remediation so the report does not label a successful adjustment as something that needs fixing. The frontend renders these fields directly and never parses localized messages to infer conversion behavior. Non-transformation diagnostics remain ordinary warnings so reachability and structural noise cannot be mistaken for rules that changed.
9. Rule-set source resolution first checks a custom target-native URL override, then a managed preset's client-specific source, and finally the row's default URL and format. Only the resulting source enters conversion. Clash, Stash, and Mihomo may share the same converted YAML container, but retain distinct target identities throughout resolution: their generators select the matching `clash` / `stash` / `mihomo` override, and a secondary Mihomo-container conversion URL carries `?for=clash` or `?for=stash` so the token endpoint repeats preflight against the same source. Unknown or node-only target contexts are rejected instead of falling back to another client's override. When that parseable source must cross Clash/Mihomo/Stash, sing-box, Surge/Loon/Shadowrocket/Quantumult X, or Egern container formats, the Worker preflights conversion before emitting the main config. It performs SSRF-guarded streaming downloads capped at 4 MiB with bounded concurrency, preserves rule-set ordering in diagnostics, and stores each converted artifact plus exact converted/skipped counts in KV for the rule set update interval. Each skipped type also carries a stable reason and bounded source examples (three per type, twenty total, 240 characters each), so previews can explain concrete semantic loss without allowing arbitrary upstream content to inflate cached artifacts or API responses. Remote redirects are followed manually with per-hop validation and cross-origin credential stripping. Reachability validation uses a fresh persisted source-health snapshot first, probes at most six previously unknown unique URLs per request, coalesces duplicates, and returns an explicit deferred-check warning for the remainder. When automatic refresh is enabled, the five-minute scheduled job fills missing or expired snapshots for every enabled rule set in bounded batches. Both caches use namespace/version-separated SHA-256 keys instead of collision-prone short hashes. Text-client targets use only the exact portable domain and CIDR subset with explicit Quantumult X aliases; Egern output uses native grouped YAML sets, and Egern source YAML can be normalized back into the shared intermediate representation. If no rule can be preserved, authenticated download and public subscription return 409 instead of emitting a broken secondary URL. The global default `compatible` policy permits a safe partial artifact with diagnostics; `strict` also blocks delivery when any directive would be skipped. Each advanced export profile may inherit that global value or override it with `compatible`/`strict`; authenticated preview, readiness, download, and token-scoped public subscription resolve the same effective policy. Preview remains diagnostic under either policy.
10. Validates the final artifact before delivery. Format-aware validators check required sections and cross-references for Mihomo-compatible YAML, sing-box JSON, Egern YAML, Surge/Loon/Shadowrocket INI, and Quantumult X CONF. sing-box validation treats top-level endpoints as routable tags, validates WireGuard endpoint peers, and rejects the removed WireGuard outbound and legacy TUN address fields; an all-protocol contract also checks generated configs against the stable 1.13 schema. This catches dangling policies, missing remote provider tags, invalid remote URLs, duplicate tags/names, and obsolete client structures after rendering rather than relying only on pre-render database validation.
11. Attaches a request correlation ID to every response and stable machine-readable error codes to export/subscription failures. The outer request logger records only the redacted subscription path plus status, duration, request ID, and error code; token values and upstream URLs remain outside structured logs. CORS exposes the correlation and error headers to the Web client, whose typed API errors retain them for UI diagnostics.
12. Generates the complete config via the appropriate generator and references a token-scoped conversion URL where required. That URL rechecks the active export profile and selected rule-set scope before serving the KV-backed artifact. Converted responses remain non-cacheable outside UniConf so pausing or rotating the token is effective immediately. Compound sing-box AND rules, binary SRS, and unsupported directives are never broadened silently.
13. Parses the rendered YAML/JSON/INI or node subscription again, validates required sections and references, and blocks malformed artifacts.
14. Returns with the proper Content-Type header.
```

---

Dashboard statistics include a count of subscription sources whose latest refresh failed, alongside the persisted remote rule-set source-health aggregate. The frontend combines those snapshots with the selected quick-export readiness result in a pure attention-center derivation. It never starts additional remote validation requests merely to populate the dashboard. Items retain severity and route directly to the query-addressable source refresh-failure view, the query-addressable remote-rule-set attention filter, the structured export remediation target, or the exact client preview. Both list filters initialize from URL parameters so dashboard links remain meaningful after reload; clearing a filter updates the URL instead of leaving a stale deep-link state.

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
│   ├── clipboard/           # Awaited clipboard writes with explicit failure propagation
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

High-risk editors register their dirty state through `core/forms/UnsavedChangesProvider`. The provider lives inside the shared confirmation-dialog boundary and uses the data router blocker for SPA navigation. Each editor also installs `beforeunload` protection while dirty and reuses the same asynchronous discard confirmation for modal close, Escape, overlay, and Cancel actions. Dirty state is derived from the opened snapshot rather than from “any input event”, so reverting to the original values or opening a pristine form does not produce a warning; successful saves close directly and unregister on the next render.

All UI clipboard writes go through `core/clipboard/write-text.ts`. Callers await the browser result before entering a copied state and render their localized `ErrorNotice` when permission, secure-context, or API availability prevents the write. This keeps public URL, generated configuration, and diagnostic copying consistent and prevents optimistic success feedback.

Config preview refreshes distinguish identity changes from retries. The full preview derives its format and optional export profile directly from `format` and `configId` query parameters; UI changes update those parameters while preserving unrelated query state, so reload and browser history reproduce the same preview identity. Export-profile discovery has its own loading/error state and retry path; failure does not clear an already loaded list or block the independent default-profile preview request. Changing the target format or export profile clears the previous artifact before requesting the new identity. Retrying the same preview retains the last successful content and diagnostics while the request is pending; a failed retry marks that snapshot stale and disables copy, while a successful response replaces content, warnings, artifact validation, and readiness together. Every request captures a monotonically increasing generation, and effect cleanup invalidates the active generation before a new format/profile request starts. Late responses and errors from an older identity cannot mutate content, capability metadata, warning state, readiness, loading, or copy feedback. The export-page inline modal follows the same state machine and generation guard instead of collapsing to an empty loading/error view.

The typed Web API client accepts `ExportFormat`, not arbitrary strings, for preview, readiness, and authenticated download operations. This keeps every generated-config call aligned with the shared format registry at compile time. A single `pathSegment` boundary percent-encodes every source, import-run, node, collection, group, rule, remote-rule-set, and export-profile ID before it enters an API route; optional export-profile query values are encoded by the same client layer. Page components always pass raw identifiers and do not hand-build dynamic endpoint URLs. This is required even though runtime-created IDs are normally UUIDs, because validated backup restores and external imports can contain otherwise valid identifiers with URL-significant characters.

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

`VITE_API_URL` can usually be omitted for the default same-origin Worker Static Assets deployment. Set it only when developing against a separate Worker origin.

### Worker (apps/worker/.env)
```
ENVIRONMENT=development
API_KEY=                # optional; leave empty to keep the API open locally
ALLOWED_ORIGIN=          # optional; restricts CORS, leave empty to allow all origins
```

### Production
Configure in Cloudflare Dashboard / wrangler:
- Worker env vars: `ENVIRONMENT=production`, `ALLOWED_ORIGIN=https://your-pages-domain`
- Worker secret: `wrangler secret put API_KEY` (required to protect `/api/*` in production)
- D1 binding: `DB` → your D1 database
- KV binding: `KV` → your KV namespace
