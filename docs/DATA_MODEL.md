# Data Model Reference

## Database: Cloudflare D1 (SQLite)

All data is stored in D1. JSON arrays/objects are stored as TEXT columns.

---

## Tables

### `sources` — Subscription Sources

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| name | TEXT | Display name |
| type | TEXT | `url` \| `manual` \| `file` \| `clipboard` |
| url | TEXT? | Subscription URL (for type=url) |
| format | TEXT | `auto` \| `clash` \| `singbox` \| `base64` \| `surge` \| `loon` |
| enabled | INTEGER | 1=enabled, 0=disabled |
| node_count | INTEGER | Cached count |
| last_updated | TEXT? | ISO timestamp of last refresh |
| update_interval | INTEGER | Minutes, 0=manual |
| user_agent | TEXT? | Custom UA for fetching |
| notes | TEXT? | User notes |
| tags | TEXT | JSON array of strings |
| source_groups | TEXT | JSON array of node group names parsed from full subscription config |
| raw_content | TEXT? | Last fetched raw subscription/config content cache |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### `nodes` — Proxy Nodes

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| source_id | TEXT FK→sources | Parent source |
| name | TEXT | Node display name |
| protocol | TEXT | `ss` \| `vmess` \| `vless` \| `trojan` \| `hysteria2` \| ... |
| server | TEXT | Hostname or IP |
| port | INTEGER | Port number |
| country | TEXT? | Country name |
| country_code | TEXT? | ISO 3166-1 alpha-2 |
| enabled | INTEGER | 1/0 |
| tags | TEXT | JSON array |
| notes | TEXT? | User notes |
| raw_config | TEXT | Original parsed config as JSON |
| parsed_config | TEXT | Normalized config as JSON |
| is_manual | INTEGER | 1 if user-entered |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### `collections` — Node Group Filter Config

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| name | TEXT | Display name |
| source_ids | TEXT | JSON array of source IDs (empty=all) |
| node_ids | TEXT | JSON array of explicit node IDs |
| filters | TEXT | JSON array of NodeFilter objects |
| renames | TEXT | JSON array of NodeRename objects |
| dedup | TEXT | `name` \| `server_port` \| `protocol_server_port` \| `full_config` |
| sort | TEXT | `country` \| `name` \| `source` \| `protocol` \| `manual` |
| sort_country_order | TEXT? | JSON array of country codes for custom order |
| enabled | INTEGER | 1/0 |
| notes | TEXT? | |
| created_at | TEXT | |
| updated_at | TEXT | |

### `groups` — Proxy Strategy Groups

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | `builtin-*` for built-ins, nanoid for user |
| name | TEXT | Group name (must be unique) |
| type | TEXT | `select` \| `url-test` \| `fallback` \| `load-balance` \| `direct` \| `reject` |
| collection_ids | TEXT | JSON array |
| group_ids | TEXT | JSON array of nested group IDs |
| builtins | TEXT | JSON array: `["DIRECT"]` or `["REJECT"]` |
| test_url | TEXT? | URL for latency testing |
| interval | INTEGER? | Test interval in seconds |
| tolerance | INTEGER? | Tolerance in ms |
| lazy | INTEGER | 1=lazy testing |
| enabled | INTEGER | 1/0 |
| sort_order | INTEGER | Display order |
| is_builtin | INTEGER | 1 if system-provided |
| created_at | TEXT | |
| updated_at | TEXT | |

**Built-in groups** (pre-seeded, `is_builtin=1`):
- `builtin-proxy` → PROXY (select)
- `builtin-ai` → AI (select)
- `builtin-streaming` → Streaming (select)
- `builtin-telegram` → Telegram (select)
- `builtin-social` → Social (select)
- `builtin-github` → GitHub (select)
- `builtin-apple` → Apple (select)
- `builtin-microsoft` → Microsoft (select)
- `builtin-final` → 漏网之鱼 (select)
- `builtin-crypto` → Crypto (select, enabled by extended template)
- `builtin-gaming` → Gaming (select, enabled by extended template)
- `builtin-developer` → Developer (select, enabled by extended template)
- `builtin-direct` → DIRECT (direct)
- `builtin-reject` → REJECT (reject)
- `builtin-all-nodes` → 全部节点 (select)
- `builtin-node-select` → 节点选择 (select)
- `builtin-auto-select` → 自动选择 (url-test)
- `builtin-fallback-select` → 故障切换 (fallback)

Built-in groups have two product roles:

| Role | Groups | Behavior |
|------|--------|----------|
| Foundation policy groups | PROXY, DIRECT, REJECT | Always available as rule targets |
| Outlet groups | 全部节点, 节点选择, 自动选择, 故障切换, country auto groups | Added as candidates inside business routing groups |
| Business routing groups | AI, Streaming, Telegram, Social, GitHub, Apple, Microsoft, 漏网之鱼, Crypto, Gaming, Developer | Used by remote rule sets, manual rules, and MATCH fallback |

`routing_policy_template` controls which business routing groups are enabled:

| Template | Enabled business groups |
|----------|-------------------------|
| `empty` | none, foundation groups only |
| `common` | AI, Streaming, Telegram, Social, GitHub, Apple, Microsoft, 漏网之鱼 |
| `extended` | common + Crypto, Gaming, Developer |

### `rules` — Traffic Routing Rules

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| name | TEXT? | Optional label |
| type | TEXT | `DOMAIN` \| `DOMAIN-SUFFIX` \| `GEOIP` \| `RULE-SET` \| `MATCH` \| ... |
| payload | TEXT | Match target |
| no_resolve | INTEGER | 1 = don't resolve DNS (for IP rules) |
| target_group_id | TEXT FK→groups | |
| enabled | INTEGER | 1/0 |
| sort_order | INTEGER | Rule evaluation order (lower = higher priority) |
| notes | TEXT? | |
| compatibility | TEXT | JSON array of ClientCompatibility objects |
| created_at | TEXT | |
| updated_at | TEXT | |

### `remote_rule_sets` — Remote Rule Set References

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| name | TEXT | Display name |
| url | TEXT | Remote URL |
| format | TEXT | `clash` \| `mihomo` \| `singbox` \| `surge` \| `text` |
| preset_source | TEXT? | Built-in preset provider, e.g. `quixotic` |
| preset_id | TEXT? | Provider-specific preset id |
| target_group_id | TEXT FK→groups | |
| update_interval | INTEGER | Hours |
| enabled | INTEGER | 1/0 |
| last_updated | TEXT? | |
| notes | TEXT? | |
| created_at | TEXT | |
| updated_at | TEXT | |

### `export_configs` — Export Configuration

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| name | TEXT | Config name |
| format | TEXT | `mihomo` \| `clash` \| `singbox` \| `loon` \| ... |
| token | TEXT UNIQUE | Random token for subscription URL |
| enabled | INTEGER | 1/0 |
| include_collection_ids | TEXT | JSON array (empty=all) |
| include_group_ids | TEXT | JSON array (empty=all) |
| include_rule_ids | TEXT | JSON array (empty=all) |
| include_remote_set_ids | TEXT | JSON array (empty=all) |
| extra_config | TEXT? | JSON of format-specific overrides |
| created_at | TEXT | |
| updated_at | TEXT | |

The system ensures a built-in default export config exists:

| Field | Value |
|-------|-------|
| id | `default-mihomo` |
| name | `默认 Mihomo 配置` |
| format | `mihomo` |
| include_*_ids | `[]` (export all enabled data) |

`app_settings.default_export_token` points to this default config token unless the user explicitly changes it.

### `app_settings` — Application Settings (Singleton)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Always `'singleton'` |
| language | TEXT | `zh` \| `en` |
| theme | TEXT | `system` \| `light` \| `dark` |
| routing_policy_template | TEXT | `empty` \| `common` \| `extended` |
| dns_mode | TEXT | `compatible` \| `smart` \| `fake-ip` |
| default_export_token | TEXT? | Token of the default export config |
| show_compatibility_warnings | INTEGER | 1/0 |
| enable_auto_refresh | INTEGER | 1/0 |
| auto_refresh_interval | INTEGER | Minutes |
| updated_at | TEXT | |

---

## JSON Field Schemas

### NodeFilter (stored in `collections.filters`)
```json
{
  "id": "filter-1",
  "field": "name",
  "operator": "not_contains",
  "value": "过期",
  "enabled": true
}
```

### NodeRename (stored in `collections.renames`)
```json
{
  "id": "rename-1",
  "type": "strip_emoji",
  "enabled": true,
  "order": 0
}
```

### SourceRefreshResult

Subscription refresh returns counts for the default node cleanup pipeline:

| Field | Description |
|-------|-------------|
| nodeCount | Persisted node count after refresh |
| addedCount | New usable nodes inserted |
| updatedCount | Existing usable nodes updated |
| removedCount | Previously stored nodes removed because they disappeared or became unusable |
| excludedCount | Parsed nodes skipped as subscription info entries or unsupported protocols |
| sourceGroupCount | Upstream node groups retained after cleanup |

Default cleanup excludes subscription info nodes such as traffic quota, expiry, package, official site, reset, and user-center entries. It also skips parsed nodes whose protocol maps to `unknown`.

### Default Export Node Names

The `nodes.name` value remains the original subscription/manual node name in storage. During export, `buildExportData` rewrites exported node names to:

```text
{country_code or Other} - {source name} - {two-digit sequence}
```

Examples:

```text
HK - Airport A - 01
US - Airport A - 02
Other - Manual - 01
```

`collectionNodeNames` is built from the rewritten names, so generated policy groups reference the same names that appear in the exported `proxies` / `outbounds` list.

### ClientCompatibility (stored in `rules.compatibility`)
```json
[
  { "client": "mihomo", "level": "full" },
  { "client": "loon", "level": "partial", "note": "Loon 不支持 GEOSITE" }
]
```

### Export Preview Warnings

`GET /api/export/preview/:format` returns `warnings: CompatibilityWarning[]` alongside the generated content.

The worker validates:

| Check | Level |
|-------|-------|
| No exported nodes | `unsupported` |
| Duplicate node names | `partial` |
| Missing nested group target | `unsupported` |
| Missing rule target group | `unsupported` |
| Missing remote rule set target group | `unsupported` |
| Missing MATCH fallback | `partial` |
| MATCH not last | `partial` |

`partial` warnings are still exported with an automatic fallback or compatibility caveat. `unsupported` warnings indicate a configuration problem that may break the target client.

---

## Migrations

Located in `apps/worker/migrations/`. File naming: `NNNN_description.sql`.

Apply locally:
```bash
pnpm --filter worker db:migrate:local
```

Apply to production:
```bash
pnpm --filter worker db:migrate
```
