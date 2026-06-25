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

Manual node writes validate the runtime shape before persistence. Protocols must come from the mainstream protocol registry, ports must be integers from 1 to 65535, names and servers are trimmed non-empty strings, tags are string arrays, and `raw_config` / `parsed_config` must be JSON objects. URI-created nodes may override parsed fields, but those overrides pass the same validation so manual entry cannot introduce `unknown`, `direct`, or `reject` pseudo-protocol nodes into export pools.

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

Generated node groups are regular `collections` plus one linked non-built-in `groups` row. Their `notes` start with `[uni-conf:auto-node-group]` and use the explicit marker format `country:{countryCode}:{type}` or `tag:{tagKey}:{type}`. There is no legacy marker compatibility.

Collection writes validate the node filtering model before persistence. Names are required, `source_ids`, `node_ids`, and `sort_country_order` must be arrays of non-empty string IDs/country codes, `filters` must use supported fields and operators, regex filters and regex renames must compile, `dedup` and `sort` must be known strategies, and list filters are trimmed and de-duplicated. This keeps advanced manual node groups from corrupting the generated outlet pools used by default policy groups.

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

Group writes validate the group graph before persistence. `type` must be one of the supported group types, user-created groups cannot use `direct` or `reject`, `collection_ids` and `group_ids` must be arrays of non-empty string IDs, `builtins` can only contain `DIRECT` or `REJECT`, and a group cannot include itself in `group_ids`. IDs are trimmed and de-duplicated on write so manual advanced edits cannot corrupt the generated routing structure.

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

Remote rule sets and manual rules target enabled rule-target groups only. A rule-target group is an enabled foundation or business policy group with no direct `collection_ids`; country auto groups and other node-backed groups remain outlet candidates inside policy groups, but are not direct rule targets. Built-in default rule sets resolve targets from the enabled group set and fall back to `PROXY` when a scenario-specific group such as `Crypto`, `Gaming`, or `Developer` is not active; the API rejects disabled, missing, or node-backed targets, and web target selectors follow the same rule so preview/export does not produce dangling policy references.

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

Manual rules are an advanced override path. Writes validate `type` against the shared rule compatibility matrix, require a payload for every rule except `MATCH`, and require an enabled rule-target group. Batch imports fail fast on the first invalid row instead of silently dropping malformed rules.

### `remote_rule_sets` — Remote Rule Set References

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| name | TEXT | Display name |
| url | TEXT | Remote URL |
| format | TEXT | `clash` \| `mihomo` \| `singbox` \| `surge` \| `text` |
| behavior | TEXT | `domain` \| `ipcidr` \| `classical` |
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

Remote rule set `format` and `behavior` are separate fields. `format` describes the source ecosystem or downloadable file type used for client compatibility and URL resolution. `behavior` describes what the rule set matches (`domain`, `ipcidr`, or `classical`) and is used by Mihomo rule-provider export. Quixotic presets default to `classical`; the UniConf Telegram domain list uses `domain`.

Rows with both `preset_source` and `preset_id` are system-managed presets. Users can disable them with the top-level rule-set switch, but deletion is reserved for custom remote rule sets so a refresh cannot silently recreate a row the UI appeared to delete.

Remote rule set API writes validate custom rule sets before persistence. Names, http(s) URLs, format, behavior, target group, positive update interval, and integer sort order are checked and trimmed. `preset_source` and `preset_id` are not client-authored through the generic API; defaults and managed presets are maintained only by `ensureDefaultRemoteRuleSets`. Resource-library selections in the UI fill a normal custom rule set URL and remain deletable.

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

Export config writes validate the advanced include filters before persistence. `include_collection_ids`, `include_group_ids`, `include_rule_ids`, and `include_remote_set_ids` must be arrays of non-empty string IDs; values are trimmed and de-duplicated. Empty arrays keep the zero-setup behavior by exporting all enabled data of that kind.

Dashboard stats, export preview/download, settings reads, group reads, and remote rule set reads are initialization points for the zero-setup path. They ensure the default export config, foundation/routing policy groups, automatic node groups, and built-in remote rule sets exist before returning user-facing state, so the first screen can show the same defaults that export will use.

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
| auto_node_groups_enabled | INTEGER | 1/0, default `1` |
| auto_node_group_types | TEXT | JSON array of `select` \| `url-test` \| `fallback`, default `["url-test"]` |
| auto_node_group_keys | TEXT? | Optional JSON array of selected generated auto group keys |
| auto_node_group_include_flag | INTEGER | 1/0, default `1` |
| updated_at | TEXT | |

Settings reads normalize nullable or invalid values back to product defaults: compatibility warnings on, auto refresh on, 24-hour refresh interval, smart DNS, smart node naming, auto node groups on, `url-test` auto group type, and flag-based country auto group names. Settings writes reject invalid enum values for language, theme, routing policy template, DNS mode, export node naming mode, and automatic node group type so normal UI/API updates cannot persist an unreachable zero-setup state.

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

`POST /api/sources` accepts `refreshAfterCreate?: boolean`. For URL sources it defaults to `true`, so API callers can create a subscription and immediately populate nodes in one request. `name` is optional on create and update; when omitted or submitted as a blank string, the worker derives it from the subscription URL host so the zero-setup path only requires the subscription link and editing a source cannot create an empty display name.

Source writes validate `type`, `format`, URL shape, refresh interval, and tags before persistence. URL sources must use an `http` or `https` subscription URL, source formats are limited to the supported parser set (`auto`, Clash/Mihomo, sing-box, base64, Surge, Loon, Quantumult X, Shadowrocket, or raw URI lines), `update_interval` must be a non-negative integer, and `tags` must be a string array that is trimmed and de-duplicated. Invalid input is rejected before it can break scheduled refresh or default export generation.

During refresh, `format = auto` uses content detection. Any explicit source format is treated as a parser hint and is tried first: Clash/Mihomo as YAML, sing-box as JSON, base64 as encoded URI lines, and raw/client-line formats as URI lines. This keeps the advanced format selector meaningful while preserving the one-link default path.

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

Clearing all data removes user sources, nodes, node groups, rules, remote rule sets, and export configs, then immediately restores the default export config, automatic node group settings, built-in routing policy groups, and managed remote rule sets. Data import runs the same default restoration after replacing tables, so partial or older backups still return to a usable zero-setup baseline. This keeps the reset and import states ready for the zero-setup flow: paste a subscription URL and export a usable config.

Default cleanup excludes subscription info nodes such as official site, user center, subscription renewal, remaining/used/total traffic, package/plan/quota, expiry, reset, and multiplier hint entries. It also skips parsed nodes whose protocol maps to `unknown`.

Country and region recognition is shared by subscription parsing, manual URI input, manual structured node creation, node group auto-generation, and routing outlet ordering. It recognizes emoji flags, standalone region codes, common English names, Chinese names, and major city aliases such as Hong Kong / 香港, Japan / Tokyo / Osaka / 日本 / 东京 / 大阪, Singapore / 新加坡 / 狮城, US / LA / Los Angeles / San Jose / 美国 / 洛杉矶 / 圣何塞, Taiwan / 台北, Korea / Seoul, United Kingdom / London, Germany / Frankfurt, France / Paris, Netherlands / Amsterdam, Australia / Sydney / Melbourne, and Canada / Toronto / Vancouver.

Node recognition writes derived metadata into `nodes.tags` when it does not need a dedicated column. Traffic multipliers are stored as:

- `multiplier:2x`, `multiplier:1x`, `multiplier:0.5x`, etc.
- `high-multiplier` when the detected multiplier is greater than `1x`.
- `streaming` for media-oriented nodes such as Netflix, YouTube, Disney+, Hulu, HBO, Spotify, Twitch, or Chinese `流媒体` names.
- `unlock` for nodes named as media/service unlock nodes.
- `residential` for home ISP / residential nodes.
- `native-ip` for native/local IP nodes.

This lets node collections reuse the existing `tag` filter to exclude high-multiplier nodes, create low-cost pools, or build streaming/residential/native candidate pools without changing the node schema. Generated auto node groups add `tag not_in ["high-multiplier"]` by default, while manually created node groups remain fully user-controlled. Auto group sync uses the same exclusion when deciding whether a generated group should exist, so countries or tag pools that only contain high-multiplier nodes do not produce empty default outlets.

Auto node group sync is driven by `app_settings`:

- `auto_node_groups_enabled`: when false, generated auto node groups and their linked policy groups are removed.
- `auto_node_group_types`: JSON array of enabled generated policy types, default `["url-test"]`; supported values are `select`, `url-test`, and `fallback`.
- `auto_node_group_keys`: optional JSON array of exact generated keys. `NULL` means include every recognized country/tag candidate; `[]` means include none.
- `auto_node_group_include_flag`: default `1`; controls whether country auto group names include emoji flags.

Auto node group sync creates these generated collections and linked policy groups when matching nodes exist and the generated key is selected:

| Generated group | Collection filter | Used first by |
|-----------------|-------------------|---------------|
| `{flag?} {countryCode} Auto/Select/Fallback` | `countryCode equals {countryCode}` + `tag not_in ["high-multiplier"]` | Country-aware routing preferences |
| `Streaming Auto/Select/Fallback` | `tag in ["streaming", "unlock"]` + `tag not_in ["high-multiplier"]` | Streaming |
| `Native Auto/Select/Fallback` | `tag in ["residential", "native-ip"]` + `tag not_in ["high-multiplier"]` | AI, Streaming |

Auto node group sync runs after subscription refreshes, manual node changes, collections reads, and auto node group setting changes. The node group page persists the user's selected generated keys; selecting nothing disables generated auto groups so the backend does not recreate them on the next sync.

Export, collection preview, and auto node group sync only consider nodes whose node row is enabled and whose source row is enabled. Disabling a subscription source therefore removes its nodes from generated node pools and exported configs without deleting the cached node rows; re-enabling the source makes the cached nodes eligible again.

Dashboard `enabledNodeCount` uses the same enabled-node query as export and auto node groups, so it counts only nodes whose node row and source row are both enabled. `nodeCount` remains the total cached node count.

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

`rules.compatibility` is not user-authored. Rule creation and batch import derive it from the shared rule compatibility matrix so API responses, forms, and preview validation stay aligned. Remote rule set format support and preset URL resolution are also centralized in `@uni-conf/shared`; the web compatibility UI, worker preview validation, and client generators use the same matrix and resolver. Preview validation still recomputes target-format warnings at export time and is the authoritative check for the selected client.

### Export Preview Warnings

`GET /api/export/preview/:format` returns `warnings: CompatibilityWarning[]` alongside the generated content.

Preview, authenticated download, and public subscription rendering all call `apps/worker/src/generators/export-renderer.ts`, so every export format uses the same content generation and content-type mapping across entry points.

The worker separates readiness checks from client compatibility checks. Readiness warnings are always returned because they indicate a config that may be empty or structurally broken. The `show_compatibility_warnings` setting only hides client capability warnings such as DNS downgrade or rule-format support.

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
