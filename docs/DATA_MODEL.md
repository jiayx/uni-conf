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
| last_refresh_error | TEXT? | Latest refresh failure message, cleared after successful refresh |
| update_interval | INTEGER | Minutes, `0` uses global auto-refresh interval |
| user_agent | TEXT? | Custom UA for fetching |
| notes | TEXT? | User notes |
| tags | TEXT | JSON array of strings |
| source_groups | TEXT | JSON array of node group names parsed from full subscription config |
| raw_content | TEXT? | Last fetched raw subscription/config content cache |
| upload_bytes / download_bytes / total_bytes / expire_time | INTEGER? | Cached `subscription-userinfo` values from the last successful refresh |
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

Manual node creation accepts either structured fields (`name`, `protocol`, `server`, `port`) or a share-link `uri`. URI input is parsed by the same parser used for raw subscription lines. Structured manual input reuses shared node recognition to fill `country`, `country_code`, and recognition `tags` from the node name when the user has not provided those fields. For URI-created nodes:

- `source_id` defaults to `manual`
- `is_manual` is `1`
- `raw_config.sourceFormat` is `uri`
- `raw_config.uri` keeps the original pasted URI
- `parsed_config` stores the normalized fields used by export, filtering, and form rendering

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

Newly generated built-in groups, auto node groups, and UI-created linked node groups use `DEFAULT_HEALTH_CHECK` from `@uni-conf/shared`:

```text
testUrl: http://www.gstatic.com/generate_204
interval: 300
tolerance: 150
lazy: true
```

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
| Foundation groups | PROXY, DIRECT, REJECT, 全部节点, 节点选择, 自动选择, 故障切换 | Always enabled by every routing policy template |
| Rule target foundations | PROXY, DIRECT, REJECT | Always available as direct rule targets |
| Outlet groups | 全部节点, 节点选择, 自动选择, 故障切换, country auto groups | Added as candidates inside business routing groups |
| Business routing groups | AI, Streaming, Telegram, Social, GitHub, Apple, Microsoft, 漏网之鱼, Crypto, Gaming, Developer | Used by remote rule sets, manual rules, and MATCH fallback |

`DIRECT` and `REJECT` are system foundation outlets, not user-created policy group types. User-created groups may use `select`, `url-test`, `fallback`, or `load-balance`; the API rejects custom `direct` / `reject` groups so rules and generated exporters keep one canonical representation for direct and reject traffic. Exporters do not emit `DIRECT` / `REJECT` as ordinary policy groups. Mihomo-compatible and text-based clients reference the native `DIRECT` / `REJECT` policies directly whenever rules or nested groups target a `direct` / `reject` row; sing-box maps the same rows to `direct` / `block` outbounds.

Business routing group `group_ids` are derived, not manually maintained. The system orders outlet candidates by intent:

| Routing group | Preferred outlet order |
|---------------|------------------------|
| AI | Native Auto, then US, JP, SG country auto groups, then 自动选择 / 节点选择 / 故障切换 |
| Streaming | Streaming Auto, Native Auto, then HK, JP, SG, TW, US country auto groups, then 自动选择 |
| Telegram | SG, HK, JP, US country auto groups, then 自动选择 |
| PROXY, GitHub, 漏网之鱼, and other groups | 自动选择 / 节点选择 / 故障切换 / 全部节点, then country auto groups |

`routing_policy_template` controls which business routing groups are enabled; foundation groups stay enabled for every template:

| Template | Recommended DNS | Enabled business groups, excluding foundation groups |
|----------|-----------------|----------------------------------------------------|
| `empty` | `smart` | none, foundation groups only |
| `minimal` | `smart` | 漏网之鱼 |
| `common` | `smart` | AI, Streaming, Telegram, Social, GitHub, Apple, Microsoft, 漏网之鱼 |
| `ai` | `smart` | AI, GitHub, Developer, Apple, Microsoft, 漏网之鱼 |
| `streaming` | `smart` | Streaming, Telegram, Social, Apple, Microsoft, 漏网之鱼 |
| `router` | `compatible` | Streaming, Telegram, GitHub, Apple, Microsoft, 漏网之鱼 |
| `extended` | `smart` | common + Crypto, Gaming, Developer |

When the user changes the scenario template, the web app saves both `routing_policy_template` and the template's recommended `dns_mode`. Users can still override DNS later in Settings.

Remote rule sets, manual rules, and advanced local template imports target enabled groups only. Built-in default rule sets resolve targets from the enabled group set and fall back to `PROXY` when a scenario-specific group such as `Crypto`, `Gaming`, or `Developer` is not active; the API rejects disabled or missing targets, and web target selectors follow the same rule so preview/export does not produce dangling policy references.

Export data applies the same rule again after resolving the final exported group set: enabled manual rules and remote rule sets whose `target_group_id` is not present in the exported groups are skipped. This prevents partial export configs or later group disable operations from generating client configs that reference non-existent policies.

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
| compatibility | TEXT | JSON array of derived ClientCompatibility objects from `@uni-conf/shared` |
| created_at | TEXT | |
| updated_at | TEXT | |

### `remote_rule_sets` — Remote Rule Set References

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| name | TEXT | Display name |
| url | TEXT | Remote URL |
| format | TEXT | `clash` \| `mihomo` \| `singbox` \| `surge` \| `text` |
| preset_source | TEXT? | Built-in preset provider: `quixotic` or `uni-conf` |
| preset_id | TEXT? | Provider-specific preset id |
| target_group_id | TEXT FK→groups | |
| update_interval | INTEGER | Hours |
| enabled | INTEGER | 1/0 |
| sort_order | INTEGER | Rule set evaluation order (lower = higher priority) |
| last_updated | TEXT? | |
| notes | TEXT? | |
| created_at | TEXT | |
| updated_at | TEXT | |

Built-in remote rule sets use deterministic `sort_order` buckets so exported configs keep the intended priority. `preset_source = 'quixotic'` means the URL is resolved dynamically per export format from QuixoticHeart/rule-set; `preset_source = 'uni-conf'` means a UniConf-maintained built-in rule set. The Telegram default is `uni-conf:telegram`, backed by MetaCubeX/meta-rules-dat `geosite/telegram.list`, because the Quixotic preset list currently folds Telegram into `socialmedia`.

Rows with both `preset_source` and `preset_id` are system-managed presets. Users can disable them with the top-level rule-set switch, but deletion is reserved for custom remote rule sets so a refresh cannot silently recreate a row the UI appeared to delete.

| Order | Rule set intent |
|-------|-----------------|
| 10 | Private / local network |
| 20 | Reject / privacy blocking |
| 30 | Direct China and client-local rules |
| 40 | AI |
| 50 | Telegram |
| 60 | Streaming |
| 70-120 | GitHub, Apple, Microsoft, Google, Gaming, Crypto |
| 130-150 | Social, proxy, ecommerce, speedtest, DMCA |
| 900 | Unknown presets |

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
| routing_policy_template | TEXT | `empty` \| `minimal` \| `common` \| `ai` \| `streaming` \| `router` \| `extended` |
| dns_mode | TEXT | `compatible` \| `smart` \| `fake-ip` |
| export_node_naming_mode | TEXT | `original` \| `region_sequence` \| `source_region_sequence` \| `smart` |
| default_export_token | TEXT? | Token of the default export config |
| show_compatibility_warnings | INTEGER | 1/0 |
| enable_auto_refresh | INTEGER | 1/0, default `1` |
| auto_refresh_interval | INTEGER | Minutes, default `1440` |
| updated_at | TEXT | |

Auto refresh is enabled by default and driven by the Worker scheduled handler. Wrangler triggers it every 5 minutes. When `enable_auto_refresh = 1`, the worker refreshes enabled URL sources that are due:

- Source `update_interval > 0` overrides the global interval.
- Source `update_interval = 0` uses `app_settings.auto_refresh_interval`, which defaults to 24 hours.
- The effective interval is clamped to at least 5 minutes.
- Sources with `last_updated = NULL` or an invalid timestamp are treated as due.

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

### SourceCreateInput / SourceCreateResult

`POST /api/sources` accepts `refreshAfterCreate?: boolean`. For URL sources it defaults to `true`, so API callers can create a subscription and immediately populate nodes in one request.

The response data is:

```ts
{
  source: ProxySource
  refresh?: SourceRefreshResult
  refreshError?: string
}
```

If refresh fails, the created source remains stored and `refreshError` contains the fetch or parse error. The caller can update the source URL, format, or User-Agent and refresh again.

Public subscription responses aggregate cached `subscription-userinfo` from enabled URL sources. `upload`, `download`, and `total` are summed; `expire` uses the earliest cached expiry. If no source has cached userinfo, UniConf returns a stable default header so clients that display subscription traffic still have a valid value.

Default cleanup excludes subscription info nodes such as traffic quota, expiry, package, official site, reset, and user-center entries. It also skips parsed nodes whose protocol maps to `unknown`.

Country and region recognition is shared by subscription parsing, manual URI input, manual structured node creation, node group auto-generation, and routing outlet ordering. It recognizes emoji flags, standalone region codes, common English names, Chinese names, and major city aliases such as Hong Kong / 香港, Japan / Tokyo / Osaka / 日本 / 东京 / 大阪, Singapore / 新加坡 / 狮城, US / LA / Los Angeles / San Jose / 美国 / 洛杉矶 / 圣何塞, Taiwan / 台北, Korea / Seoul, United Kingdom / London, Germany / Frankfurt, France / Paris, Netherlands / Amsterdam, Australia / Sydney / Melbourne, and Canada / Toronto / Vancouver.

Node recognition writes derived metadata into `nodes.tags` when it does not need a dedicated column. Traffic multipliers are stored as:

- `multiplier:2x`, `multiplier:1x`, `multiplier:0.5x`, etc.
- `high-multiplier` when the detected multiplier is greater than `1x`.
- `streaming` for media-oriented nodes such as Netflix, YouTube, Disney+, Hulu, HBO, Spotify, Twitch, or Chinese `流媒体` names.
- `unlock` for nodes named as media/service unlock nodes.
- `residential` for home ISP / residential nodes.
- `native-ip` for native/local IP nodes.

This lets node collections reuse the existing `tag` filter to exclude high-multiplier nodes, create low-cost pools, or build streaming/residential/native candidate pools without changing the node schema. Generated auto node groups add `tag not_in ["high-multiplier"]` by default, while manually created node groups remain fully user-controlled. Auto group sync uses the same exclusion when deciding whether a generated group should exist, so countries or tag pools that only contain high-multiplier nodes do not produce empty default outlets.

Auto node group sync creates these generated collections and linked policy groups when matching nodes exist:

| Generated group | Collection filter | Used first by |
|-----------------|-------------------|---------------|
| `{flag} {countryCode} Auto` | `countryCode equals {countryCode}` + `tag not_in ["high-multiplier"]` | Country-aware routing preferences |
| `Streaming Auto` | `tag in ["streaming", "unlock"]` + `tag not_in ["high-multiplier"]` | Streaming |
| `Native Auto` | `tag in ["residential", "native-ip"]` + `tag not_in ["high-multiplier"]` | AI, Streaming |

Auto node group sync runs after subscription refreshes and manual node changes. The collections list endpoint also performs a read-time sync so the node group page reflects the current node inventory.

Export, collection preview, and auto node group sync only consider nodes whose node row is enabled and whose source row is enabled. Disabling a subscription source therefore removes its nodes from generated node pools and exported configs without deleting the cached node rows; re-enabling the source makes the cached nodes eligible again.

### Default Export Node Names

The `nodes.name` value remains the original subscription/manual node name in storage. During export, `buildExportData` first deduplicates the final node rows by full parsed config, then rewrites exported node names to:

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

`rules.compatibility` is not user-authored. Rule creation, batch import, and template import derive it from the shared rule compatibility matrix so API responses, forms, and preview validation stay aligned. Remote rule set format support and preset URL resolution are also centralized in `@uni-conf/shared`; the web compatibility UI, worker preview validation, and client generators use the same matrix and resolver. Preview validation still recomputes target-format warnings at export time and is the authoritative check for the selected client.

### Export Preview Warnings

`GET /api/export/preview/:format` returns `warnings: CompatibilityWarning[]` alongside the generated content.

The worker validates:

| Check | Level |
|-------|-------|
| No exported nodes | `unsupported` |
| Duplicate node names | `partial` |
| Source has latest refresh error | `unsupported` |
| Source has never refreshed successfully | `partial` |
| Missing nested group target | `unsupported` |
| Missing rule target group | `unsupported` |
| Rule type unsupported by target export format | `unsupported` |
| Rule type partially supported by target export format | `partial` |
| Missing remote rule set target group | `unsupported` |
| Remote rule set incompatible with export format | `partial` |
| Remote rule set URL is not downloadable over http(s) | `unsupported` |
| DNS mode cannot be fully represented by target export format | `partial` |
| MATCH not last | `partial` |

If no explicit `MATCH` rule exists, exporters append the fallback policy automatically and preview does not warn; this is the normal zero-setup path. `partial` warnings are still exported with an automatic fallback or compatibility caveat. `unsupported` warnings indicate a configuration problem that may break the target client.

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
