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
| format | TEXT | `auto` \| `clash` \| `mihomo` \| `singbox` \| `base64` \| `surge` \| `loon` \| `quantumultx` \| `shadowrocket` \| `raw` |
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
- if the user overrides the URI display name, country and recognition tags are derived from the final display name unless explicitly provided

Manual node writes validate the runtime shape before persistence. Protocols must come from the mainstream protocol registry, ports must be integers from 1 to 65535, names and servers are trimmed non-empty strings, tags are string arrays, and `raw_config` / `parsed_config` must be JSON objects. The web structured manual-node form is generated from the protocol registry and uses a shared core helper to persist every registry field into `parsed_config.extra`, while promoting common export fields such as `password`, `uuid`, `tls`, `sni`, `skipCertVerify`, `network`, and `wsPath` to the normalized top level. Required protocol fields from the registry are enforced in the web form and again by the worker API, so direct API calls cannot create or update structured manual nodes that are missing credentials such as AnyTLS password, TUIC UUID/password, or WireGuard keys. URI-created nodes may override parsed fields, but those overrides pass the same validation so manual entry cannot introduce `unknown`, `direct`, or `reject` pseudo-protocol nodes into export pools. Updates always synchronize row-level `protocol`, `server`, and `port` back into `parsed_config` before validation and persistence, because exporters use `parsed_config` as the authoritative normalized node shape. When a manual node is renamed, the worker re-runs country and recognition-tag detection unless the request explicitly provides `country`, `countryCode`, or `tags`, so automatic country/tag node groups follow the new node name after the zero-setup sync. Web-side Clash, sing-box, URI, and base64 parsers use the same shared country, recognition-tag, and subscription-info-node filters as the worker parser, keeping local import previews aligned with persisted node fields.

When subscription parsing caches native client config in `raw_config.mihomo` or `raw_config.singbox`, the matching full-config exporter prefers that native object and only overwrites the current display name / tag, server, and port. If `raw_config` itself is already a Mihomo proxy object or sing-box outbound object, the same rule applies. This preserves client-specific fields that are not yet represented in the normalized model while keeping user-visible renames and node edits effective.

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

Generated node groups are regular `collections` plus one node-backed outlet `groups` row. Product UI treats the pair as one node group outlet; users do not manually link a collection to a policy group. Generated collection `notes` start with `[uni-conf:auto-node-group]` and use the explicit marker format `country:{countryCode}:{type}` or `tag:{tagKey}:{type}`. There is no legacy marker compatibility.

The node group UI must lead with localized zero-setup language: the main action is automatic generation by country/region, tag pool, or upstream subscription group, generated rows are labeled as automatic, and the auto-generation modal explains that `url-test` groups are selected by default while manual select/fallback and upstream groups are optional. `apps/web/src/core/collections/collections-i18n.test.ts` guards those labels so the page does not imply users must manually build node filters before export works.

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

Newly generated built-in groups, auto node group outlets, and UI-created node group outlets use `DEFAULT_HEALTH_CHECK` from `@uni-conf/shared`:

```text
testUrl: http://www.gstatic.com/generate_204
interval: 300
tolerance: 150
lazy: true
```

Full-config exporters preserve this managed health-check baseline when the target client supports equivalent fields. Mihomo-compatible configs emit `url`, `interval`, `tolerance`, and `lazy`; sing-box urltest groups emit the same URL, interval, and tolerance; Loon, Surge, Shadowrocket, Quantumult X, and Egern emit the compatible URL and interval fields.

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

Built-in groups have distinct product roles:

| Role | Groups | Behavior |
|------|--------|----------|
| Rule target foundations | PROXY, DIRECT, REJECT | Always enabled by every routing policy template and always available as direct rule targets |
| Global node outlets | 全部节点, 节点选择, 自动选择, 故障切换 | Always enabled by every routing policy template, backed by the system default usable node pool, and only used as outlet candidates inside routing groups |
| Outlet groups | 全部节点, 节点选择, 自动选择, 故障切换, country auto groups | Added as candidates inside business routing groups |
| Business routing groups | AI, Streaming, Telegram, Social, GitHub, Google, Apple, Microsoft, 漏网之鱼, Crypto, Gaming, Developer | Used by remote rule sets, manual rules, and MATCH fallback |

`PROXY` has no hard-coded builtin members; sync fills its outlet candidates from the current enabled foundation, global-node, and node-backed outlet groups. The four global node outlets reference the managed `builtin-default-node-pool` collection named `默认可用节点`, whose notes are `[uni-conf:default-node-pool]` and whose default filter is `tag not_in ["high-multiplier"]`. This keeps global outlets usable in zero setup without making high-multiplier nodes default candidates; users who want high-multiplier nodes can create a manual node group. Fresh database migrations also normalize these managed rows statically, and runtime zero-setup sync re-applies the same model before user-facing reads and exports. `DIRECT` and `REJECT` are system foundation outlets, not user-created policy group types. User-created groups may use `select`, `url-test`, `fallback`, or `load-balance`; the API rejects custom `direct` / `reject` groups so rules and generated exporters keep one canonical representation for direct and reject traffic. Exporters do not emit `DIRECT` / `REJECT` as ordinary policy groups. Mihomo-compatible and text-based clients reference the native `DIRECT` / `REJECT` policies directly whenever rules or nested groups target a `direct` / `reject` row; sing-box maps the same rows to `direct` / `block` outbounds.

The fresh install schema mirrors the same managed zero-setup graph: it creates `builtin-default-node-pool`, binds `全部节点` / `节点选择` / `自动选择` / `故障切换` to that collection, and includes the current built-in business targets such as `Google`. Later normalization migrations remain idempotent repair steps for already-created databases, not the only source of the current default graph.

Shared group-category helpers are the source of truth for product surfaces: `builtin-proxy`, `builtin-direct`, and `builtin-reject` are rule-target foundation groups; `builtin-all-nodes`, `builtin-node-select`, `builtin-auto-select`, and `builtin-fallback-select` are global node outlets; neither category is shown as an editable business routing group. This keeps the empty scenario template understandable: it removes extra business groups only, while `PROXY / DIRECT / REJECT` and the global node outlets stay visible in the fixed foundation area.

The policy group UI must explain the same split with localized copy: the default routing template comes first, fixed rule foundations and global node outlets are shown as always-present system groups, and custom business routing groups are presented only as optional supplements. `apps/web/src/core/groups/group-i18n.test.ts` guards the translation keys for this zero-setup guidance so product text does not regress into hard-coded locale-specific labels.

Group writes validate the group graph before persistence. `type` must be one of the supported group types, user-created groups cannot use `direct` or `reject`, and user-created group names cannot collide with built-in policy group names such as `AI`, `Streaming`, `DIRECT`, or `自动选择`. `collection_ids` and `group_ids` must be arrays of non-empty string IDs, `builtins` can only contain `DIRECT` or `REJECT`, and a group cannot include itself in `group_ids`. IDs are trimmed and de-duplicated on write so manual advanced edits cannot corrupt the generated routing structure.

Business routing group `group_ids` are derived, not manually maintained. The web form for policy groups edits the group identity, enabled state, type, health-check behavior, and an optional default outlet preference. Outlet candidates are shown as automatically maintained and are not submitted as user-authored relationships. When a default outlet preference exists, sync moves that outlet to the front of the derived member list and keeps the rest of the system-generated candidates after it. Preferences store stable outlet refs rather than generated group IDs: regular groups use `group:{groupId}`, while automatic node groups use `auto:{autoNodeGroupMarkerKey}` such as `auto:country:US:url-test`. `auto:` preference refs are validated with the same `@uni-conf/shared` auto-node marker parser used by generated collections and auto-node settings. This lets users answer intent-level questions such as “AI 走美国” without manually linking every policy group to every node group, and keeps the preference valid if an automatic country group is deleted and recreated after node changes. Without a saved preference, the system orders outlet candidates by intent:

The zero-setup initializer owns the default graph order: default export config, automatic node groups, routing policy group links, then managed remote rule sets. Export preview, authenticated download, and public subscription generation call that initializer before collecting export rows, so managed rule sets are assigned after the foundation outlets (`PROXY`, `DIRECT`, `REJECT`) and their derived `group_ids` are current, even when the user only pasted subscription URLs and never opened the policy group page.

Readiness validation checks the final export graph, not only stored IDs. A policy group that references a missing child group is reported as unsupported, and a node-backed policy group whose collection has no final exported nodes is reported before download. Compatibility validation also checks node protocol support for the selected exporter. If a collection member name is not present in the final `proxies` / outbound node list after filtering, dedupe, renaming, or protocol compatibility filtering, preview returns a warning instead of silently producing a group that points at a missing proxy.

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
| `common` | `smart` | AI, Streaming, Telegram, Social, GitHub, Google, Apple, Microsoft, 漏网之鱼 |
| `ai` | `smart` | AI, GitHub, Google, Developer, Apple, Microsoft, 漏网之鱼 |
| `streaming` | `smart` | Streaming, Telegram, Social, Apple, Microsoft, 漏网之鱼 |
| `router` | `compatible` | Streaming, Telegram, GitHub, Google, Apple, Microsoft, 漏网之鱼 |
| `extended` | `smart` | common + Crypto, Gaming, Developer |

When the user changes the scenario template, the worker derives the template's recommended `dns_mode` if the settings update omits an explicit DNS value; explicit DNS updates still win so users can override DNS later in Settings. The web app also sends both values when the user switches templates, and route tests cover both the combined write and backend derivation path.

Remote rule sets and manual rules target enabled rule-target groups only. A rule-target group is `PROXY`, `DIRECT`, `REJECT`, or an enabled business policy group with no direct `collection_ids`. Global node outlets (`全部节点`, `节点选择`, `自动选择`, `故障切换`), country auto groups, and other node-backed groups remain outlet candidates inside policy groups, but are not direct rule targets. Enabled custom non-node groups are treated as business routing groups too, so a user-created group such as `Downloads` or `Crypto` automatically receives the same foundation outlets, global node outlets, and node-backed outlet groups as the built-in scenario groups. Built-in managed rule sets resolve targets from the full built-in group set and only enable rows whose target is active. If a managed rule set targets a business group that the active scenario template has not enabled, the worker creates or updates that managed row as disabled with an internal missing-target note instead of hiding it or silently falling back to `PROXY`; switching to a template that enables the group re-enables and retargets only rows with that internal note. User-disabled managed rows stay disabled. Foundation targets (`PROXY`, `DIRECT`, `REJECT`) remain available in every template. Custom remote rule set and manual rule create APIs default an omitted or blank target to `PROXY`; explicit update targets must still be enabled rule-target groups. The API rejects disabled, missing, global-node-outlet, or node-backed targets, and web target selectors follow the same rule so preview/export does not produce dangling policy references.

Quixotic managed presets include common gaming traffic such as Steam. Steam targets the `Gaming` business group and uses the gaming priority band, so it is automatically enabled by the extended template and system-disabled in templates that do not expose Gaming.

Export data applies the same rule again after resolving the final exported group set: enabled manual rules and remote rule sets whose `target_group_id` is not present in the exported groups are skipped. This prevents partial export configs or later group disable operations from generating client configs that reference non-existent policies.

Manual rules are local overrides for exceptional cases; the default routing path comes from managed remote rule sets. The web UI must present this page as optional, with localized empty-state and batch-import guidance that points users back to preset routing policies for normal traffic. `apps/web/src/core/rules/rules-i18n.test.ts` guards those labels. The web batch importer accepts Clash-style lines, resolves target groups by id or name, and uses the selected fallback target when a line omits policy. This parser lives in `apps/web/src/core/rules/manual-rules.ts` so the local-rule supplement path is tested separately from the page UI.

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

Manual rules are an advanced override path. Writes validate `type` against the shared rule compatibility matrix, require a payload for every rule except `MATCH`, and default omitted create targets to `PROXY`. Explicit targets must be enabled rule-target groups. Batch imports fail fast on the first invalid row instead of silently dropping malformed rules.

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

Built-in remote rule sets use deterministic `sort_order` buckets so exported configs keep the intended priority. `preset_source = 'quixotic'` means the URL is resolved dynamically per export format from QuixoticHeart/rule-set; `preset_source = 'uni-conf'` means a UniConf-maintained built-in rule set. Quixotic `fake-ip-filter` is an exception to the generated `ruleset/{format}` path: it resolves to `https://github.com/QuixoticHeart/rule-set/raw/refs/heads/master/custom/domain/fake-ip-filter.list` and uses `domain` behavior. The Telegram default is `uni-conf:telegram`, backed by MetaCubeX/meta-rules-dat `geosite/telegram.list`, because the Quixotic preset list currently folds Telegram into `socialmedia`.

Remote rule set `format` and `behavior` are separate fields. `format` describes the source ecosystem or downloadable file type used for client compatibility and URL resolution. `behavior` describes what the rule set matches (`domain`, `ipcidr`, or `classical`) and is used by Mihomo rule-provider export. Quixotic presets default to `classical`; the UniConf Telegram domain list uses `domain`.

Rows with both `preset_source` and `preset_id` are system-managed presets. Users can disable them with the top-level rule-set switch, but editing and deletion are reserved for custom remote rule sets so a refresh cannot silently recreate or overwrite a row the UI appeared to let the user own. Default restoration also normalizes managed preset metadata: Quixotic rows are kept at the canonical Mihomo/classical source URL used as the database baseline, while export rendering still resolves the final URL dynamically for the requested client format. Managed presets follow the active routing template: service-specific rows are stored for their canonical business target but enabled only when that target business group is enabled, while foundation rows for `PROXY`, `DIRECT`, and `REJECT` stay available in every template. Template-driven disables use an internal note marker so later template changes can restore those rows without overriding a user's explicit disabled switch.

The routing-policy UI groups remote rule sets by the target used after a match, not by source URL. It shows `PROXY / DIRECT / REJECT` as fixed foundations, marks managed presets as system-maintained, and labels user-created rows as supplemental rule sets. `apps/web/src/core/remote-rules/remote-rule-sets-i18n.test.ts` guards those localized zero-setup labels so the page keeps presenting rule-set work as an optional override instead of required configuration.

Remote rule set API writes validate custom rule sets before persistence. Names, http(s) URLs, format, behavior, positive update interval, and integer sort order are checked and trimmed. Create requests default omitted targets to `PROXY`; explicit targets must be enabled rule-target groups. Enabling an existing rule set also validates its current target group, so a template-disabled managed rule set cannot be manually switched on while its business target is still disabled. `preset_source` and `preset_id` are not client-authored through the generic API; defaults and managed presets are maintained only by `ensureDefaultRemoteRuleSets`. Resource-library selections in the UI fill a normal custom rule set URL and remain deletable.

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
| format | TEXT | `mihomo` \| `singbox` \| `loon` \| ... |
| token | TEXT UNIQUE | Random token for subscription URL |
| enabled | INTEGER | 1/0 |
| include_collection_ids | TEXT | JSON array (empty=all) |
| include_group_ids | TEXT | JSON array (empty=all) |
| include_rule_ids | TEXT | JSON array (empty=all) |
| include_remote_set_ids | TEXT | JSON array (empty=all) |
| extra_config | TEXT? | Optional JSON object of format-specific overrides; `NULL` means no overrides |
| created_at | TEXT | |
| updated_at | TEXT | |

The system ensures a built-in default export config exists:

Export config create/update validation rejects malformed advanced overrides:

- `extra_config` may only be a JSON object or `NULL`.
- Scalar values and arrays are rejected before the config is stored.

| Field | Value |
|-------|-------|
| id | `default-mihomo` |
| name | `默认 Mihomo 配置` |
| format | `mihomo` |
| include_*_ids | `[]` (export all enabled data) |

`app_settings.default_export_token` points to this default config token unless the user explicitly changes it. If the token of the currently referenced export config is reset, the settings row is updated in the same request so the default subscription link keeps pointing at that config instead of falling back to another export config on the next zero-setup sync.

Authenticated preview and download endpoints reuse the selected export config for scope only. The rendered client format comes from the route parameter (`/api/export/preview/:format` or `/api/export/download/:format`), so zero-setup quick downloads can produce sing-box, Loon, or other supported formats from the same default Mihomo-scoped config without creating separate configs first. Public subscription URLs use the token plus canonical filename to identify both the config and the requested format.

Export config writes validate the advanced include filters before persistence. `include_collection_ids`, `include_group_ids`, `include_rule_ids`, and `include_remote_set_ids` must be arrays of non-empty string IDs; values are trimmed and de-duplicated. Empty arrays keep the zero-setup behavior by exporting all enabled data of that kind. Create and update writes use the same display-name normalization: a blank name is replaced with the default name derived from the selected target format, while a non-blank name is trimmed before storage.

The export UI must preserve that default-complete mental model: normal export never requires the user to create an export config first, and the default export must not ask the user to choose a single output format. The page should present the system-maintained default export as already available and list all quick-export URLs generated from the same default token. Each quick-export row can open `/preview?format={format}` to inspect the generated content for that concrete client format while still using the default export scope. The stored `format` on the default row is only a legacy primary-format value for APIs that require a config row; the requested client format comes from the download route or public subscription filename. Extra `export_configs` are advanced export profiles for separate subscription tokens or narrowed node/rule scopes, and those profiles may keep a primary format for their main link, download, validation, preview, and compatible-rule-set filtering. The modal leads with localized copy for that advanced-profile purpose, hides include filters under advanced scope controls, and uses localized scope/validation summaries generated from the same effective export graph as the worker. Config preview is not a separate primary navigation destination; `/preview` remains available as a deep inspection tool for generated content, while the sidebar and onboarding steps send users to export. `apps/web/src/core/export/export-i18n.test.ts` guards the translation keys for those zero-setup export labels.

When `include_group_ids` selects only a subset of policy groups, export data expands the final group set through derived `group_ids` before collecting nodes. Node output is then scoped to the collections referenced by the expanded group set. The global node outlets reference the managed default usable node pool, so preview/download/public subscription include all nodes that match that pool rather than every raw subscription node. This keeps every proxy group member that can point at nodes aligned with matching `proxies` / `outbounds` entries in the rendered config while preserving the default high-multiplier exclusion.

sing-box export uses the actual generated policy tag for DNS proxy detours and remote rule-set downloads. In the zero-setup graph this is `PROXY`; if no proxy policy group is present in a narrow generator test or custom export scope, it falls back to the same final policy resolution used by routing, then to `direct`. The generator must not emit a hard-coded lowercase `proxy` detour because the default policy group is stored and exported as `PROXY`.

sing-box manual `GEOSITE` rules are emitted as `rule_set` route rules and the generator declares the matching SagerNet geosite remote rule set automatically, for example `GEOSITE,google,PROXY` produces a `geosite-google` rule-set definition. This keeps advanced local overrides from creating sing-box configs with route rules that reference undeclared rule-set tags.

Loon, Surge, and Shadowrocket local rule rendering uses the shared rule compatibility matrix before writing rules. Rules marked `unsupported` for the target client are skipped instead of being emitted verbatim, so preview compatibility warnings and generated configs stay aligned. `partial` rules can still be rendered when the exporter has a known representation or acceptable downgrade.

All full-config renderers append the same zero-setup fallback semantics when no enabled `MATCH` / `FINAL` rule is present. Disabled `MATCH` rows do not suppress the automatic fallback. Mihomo-compatible, sing-box, Loon, Surge, Shadowrocket, Quantumult X, and Egern exports choose `漏网之鱼` when available, then `PROXY`, then the first available policy, with a native direct fallback only when no policy exists. This keeps a one-link subscription usable even when the user never opens the manual rule editor.

Dashboard stats, export config reads/writes, export preview/download, public subscription rendering, settings reads, policy group reads/writes, node group reads/writes, subscription source reads/create/update/refresh/delete, manual node reads/create/update/delete, manual rule reads/writes/deletes, and remote rule set reads/writes/deletes are initialization points for the zero-setup path. List and detail read endpoints both count as reads, so directly opening an advanced detail page cannot bypass default initialization. They ensure the default export config, foundation/routing policy groups, automatic node groups, and built-in remote rule sets exist before returning user-facing state or validating user-authored rules, so the first screen, subscription refresh flow, export config editor, policy/node group editors, and advanced rule editors use the same defaults that export will use. The worker keeps a service-level integration test for this path: recognized subscription nodes must materialize into the default export config, default usable node pool, automatic country/tag node groups, routing policy members, and managed remote rule sets together.

### `app_settings` — Application Settings (Singleton)

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Always `'singleton'` |
| language | TEXT | `zh` \| `en` |
| theme | TEXT | `system` \| `light` \| `dark` |
| routing_policy_template | TEXT | `empty` \| `minimal` \| `common` \| `ai` \| `streaming` \| `router` \| `extended` |
| routing_outlet_preferences | TEXT? | JSON object `{ routingGroupId: outletRef }` used to move a preferred outlet to the front of generated policy members |
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

Settings reads normalize nullable or invalid values back to product defaults: Chinese UI language, system theme, common routing policy template, compatibility warnings on, auto refresh on, 24-hour refresh interval, smart DNS, smart node naming, auto node groups on, `url-test` auto group type, flag-based country auto group names, no routing outlet overrides, and no default export token unless the stored token is a non-empty string. An explicit empty `auto_node_group_types` array is preserved as the user's choice to disable generated auto node group types; only missing, malformed, or all-invalid values fall back to `["url-test"]`. Settings writes use the shared `AppSettingsPatch` type, which separates normalized response values from write-only clear operations. They reject invalid enum values for language, theme, routing policy template, DNS mode, export node naming mode, automatic node group type, non-positive or non-integer auto refresh intervals, malformed routing outlet preference maps, and malformed default export tokens so normal UI/API updates cannot persist an unreachable zero-setup state. A submitted `default_export_token` must be a non-empty string after trimming, or `NULL` to clear it. A submitted `routing_outlet_preferences` value must be an object with stable refs, `{}` or `NULL` to clear all preferences. A submitted `auto_node_group_keys` value must be an array of canonical keys, `[]` to generate no country/tag auto groups, or `NULL` to return to the zero-setup default of including every recognized candidate. Routing outlet preference values must use `group:{groupId}` or `auto:{autoNodeGroupMarkerKey}`; raw database IDs such as `us-auto` are rejected.

The settings UI presents DNS mode, export node naming, and automatic node groups as localized intent options, not required setup steps. DNS defaults to smart anti-pollution, automatic node groups default to country/tag `url-test` outlets with flag names, and the exact generated country/tag/subscription groups remain controlled from the node group auto-generation panel. `apps/web/src/core/settings/settings-i18n.test.ts` guards the translation keys for these zero-setup settings labels.

Auto refresh is enabled by default and driven by the Worker scheduled handler. Wrangler triggers it every 5 minutes, and the worker entrypoint has a scheduled-handler test that verifies it delegates to `refreshDueSources`. When `enable_auto_refresh = 1`, the worker refreshes enabled URL sources that are due:

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

`POST /api/sources` accepts `refreshAfterCreate?: boolean`. For URL sources it defaults to `true`, so API callers can create a subscription and immediately populate nodes in one request; the worker route has a default-refresh test so this behavior does not depend on the web UI passing the flag. `name` is optional on create and update; when omitted or submitted as a blank string, the worker derives it from the subscription URL host so the zero-setup path only requires the subscription link and editing a source cannot create an empty display name. The web zero-setup entry points accept one or more pasted subscription URLs and create one source per valid `http(s)` URL, leaving names blank for multi-source input so each source is named from its own host. URL parsing is shared and tested for newline, whitespace, English comma, Chinese comma, duplicate, labelled paste text, trailing punctuation, and invalid-token handling so Dashboard and Sources keep the same paste behavior.

Source writes validate `type`, `format`, URL shape, refresh interval, advanced text fields, and tags before persistence. When a create request includes a subscription `url` but omits `type`, the worker treats it as a URL subscription source so API callers can follow the same one-field default path as the UI. URL sources must use an `http` or `https` subscription URL and are stored after trimming surrounding whitespace. Source formats are limited to the supported parser set (`auto`, Clash/Mihomo, sing-box, base64, Surge, Loon, Quantumult X, Shadowrocket, or raw URI lines), `update_interval` must be a non-negative integer, `user_agent` and `notes` must be strings or `NULL` when explicitly submitted, and `tags` must be a string array that is trimmed and de-duplicated. Invalid input is rejected before it can break scheduled refresh or default export generation.

The web source form treats creation and update differently for User-Agent defaults. Creation omits an empty User-Agent so the worker can use its default fetch header. Updating an existing source sends an explicit empty string when the user selects the default option, which lets the worker clear a previously saved custom User-Agent; changing URL, parser format, or User-Agent then triggers an immediate refresh from the web flow.

The source-management UI keeps the zero-setup create path focused on the subscription URL. Name, parser format, refresh interval, User-Agent, notes, and the refresh toggle remain in the advanced section, and user-facing labels, placeholders, User-Agent choices, save/refresh errors, and subscription traffic fields are all localized through `apps/web/src/i18n/*`. This keeps the dashboard and source page aligned on the same “paste links first” workflow.

Refresh caches fetched `raw_content` and `subscription-userinfo` immediately after a successful HTTP response, before node parsing validates usable proxies. This preserves complete upstream configs for future parser/export reuse even when the current parser cannot yet turn the content into usable nodes, and the route test covers this parse-failure cache path.

During refresh, `format = auto` uses content detection. Any explicit source format is treated as a parser hint and is tried first: Clash/Mihomo as YAML, sing-box as JSON, base64 as encoded URI lines, and raw/client-line formats as URI lines. This keeps the advanced format selector meaningful while preserving the one-link default path.

Source refresh, enable/disable, and deletion all resynchronize automatic node groups and derived routing policy group members. Refresh keeps node rows stable when a subscription updates the server or port for a uniquely named node from the same source, so imported upstream node groups that store explicit node IDs do not break just because an airport rotated endpoints. Duplicate node names fall back to the full `server:port:name` identity to avoid merging distinct nodes. The web source editor immediately refreshes URL subscriptions after changing the URL, parser format, or User-Agent, and this refresh trigger is covered by a shared UI core test instead of being embedded only in the React component. Manual refresh failures still record `last_refresh_error` and run the zero-setup initializer, so a bad subscription cannot leave the default export config, foundation policy groups, or managed rule sets missing. Scheduled auto-refresh initializes the default graph before scanning due sources and runs it again after any due-source batch finishes, so country/tag node groups and policy members reflect the final refreshed node set even when the batch has mixed success and failure. Source deletion explicitly removes nodes for that source before removing the source row, so export readiness and generated node groups do not depend on database-level foreign-key cascade behavior.

Upstream source groups parsed from full subscription configs are stored in `sources.source_groups`. The parser filters client built-in direct/reject members from upstream groups (`DIRECT` / `REJECT` for Mihomo-compatible configs and `direct` / `block` for sing-box configs, case-insensitively), so import suggestions only contain real node members. The node group page can import them as explicit-node collections by matching member names against nodes from the same source only. Imported collections use notes marker `[uni-conf:source-node-group] {sourceId}:{encodedGroupName}` so the UI can show already-imported groups and avoid creating duplicate node pools. Later subscription refreshes resynchronize those imported collections' `node_ids` from the current upstream group membership, preserving the user's selection while avoiding manual re-import when the provider adds, removes, or rotates nodes. Batch imports create linked outlet groups with consecutive sort orders after the current group list, so imported upstream groups keep a stable display order.

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

Data backup export runs zero-setup default restoration before reading tables. A fresh or recently cleared database therefore exports the same managed default export config, policy groups, node pools, and remote rule set rows that normal UI/API reads would materialize, instead of serializing an uninitialized skeleton. Clearing all data removes user sources, nodes, node groups, rules, remote rule sets, and export configs, then immediately restores the default export config, automatic node group settings, built-in routing policy groups, and managed remote rule sets. Data import runs the same default restoration after replacing tables, so partial or older backups still return to a usable zero-setup baseline. This keeps backup, reset, and import states ready for the zero-setup flow: paste a subscription URL and export a usable config.

Default cleanup excludes subscription info nodes such as official site, user center, subscription renewal, remaining/used/total traffic, package/plan/quota, expiry, reset, and multiplier hint entries. It also skips parsed nodes whose protocol maps outside the mainstream protocol registry, and nodes whose parsed/native config is missing protocol-required fields such as Trojan password, VMess UUID, AnyTLS password, TUIC UUID/password, or WireGuard keys. The same worker protocol validator is used by subscription refresh and manual node writes so default export pools are not polluted by nodes that can be parsed syntactically but cannot produce a usable client config.

Country and region recognition is shared by subscription parsing, manual URI input, manual structured node creation and rename updates, node group auto-generation, and routing outlet ordering. It recognizes emoji flags, standalone region codes, common English names, Chinese names, and major city aliases such as Hong Kong / 香港, Japan / Tokyo / Osaka / 日本 / 东京 / 大阪, Singapore / 新加坡 / 狮城, US / LA / Los Angeles / San Jose / 美国 / 洛杉矶 / 圣何塞, Taiwan / 台北, Korea / Seoul, United Kingdom / London, Germany / Frankfurt, France / Paris, Netherlands / Amsterdam, Australia / Sydney / Melbourne, and Canada / Toronto / Vancouver.

Node recognition writes derived metadata into `nodes.tags` when it does not need a dedicated column. Traffic multipliers are stored as:

- `multiplier:2x`, `multiplier:1x`, `multiplier:0.5x`, etc.
- `high-multiplier` when the detected multiplier is greater than `1x`.
- `streaming` for media-oriented nodes such as Netflix, YouTube, Disney+, Hulu, HBO, Spotify, Twitch, or Chinese `流媒体` names.
- `unlock` for nodes named as media/service unlock nodes.
- `residential` for home ISP / residential nodes.
- `native-ip` for native/local IP nodes.

This lets node collections reuse the existing `tag` filter to exclude high-multiplier nodes, create low-cost pools, or build streaming/residential/native candidate pools without changing the node schema. Generated auto node groups add `tag not_in ["high-multiplier"]` by default, while manually created node groups remain fully user-controlled. Auto group sync uses the same exclusion when deciding whether a generated group should exist, so countries or tag pools that only contain high-multiplier nodes do not produce empty default outlets.

Auto node group sync is driven by `app_settings`:

- `auto_node_groups_enabled`: when false, generated auto node group outlets are removed.
- `auto_node_group_types`: JSON array of enabled generated policy types, default `["url-test"]`; supported values are `select`, `url-test`, and `fallback`.
- `auto_node_group_keys`: optional JSON array of exact generated keys. `NULL` means include every recognized country/tag candidate; `[]` means include none. Valid keys use the canonical `country:{ISO2}:{type}` or `tag:{key}:{type}` form, for example `country:US:url-test` or `tag:streaming:fallback`; old shorthand keys such as `US:url-test` are rejected on settings writes.
- `auto_node_group_include_flag`: default `1`; controls whether country auto group names include emoji flags.

Auto node group sync always ensures the managed default usable node pool exists, even when country/tag auto node groups are disabled. It then creates generated collections plus node-backed outlet groups when matching nodes exist and the generated key is selected. If `auto_node_group_keys` is unset, sync treats every currently recognized country and supported tag pool as selected, so a freshly refreshed subscription can produce usable country / tag outlets without the user opening node-group settings first. The node group UI shows both country/region candidates and tag-pool candidates such as Streaming / Unlock and Native / Residential, using the same high-multiplier exclusion as the backend; when there is no explicit saved key list or existing generated collection to read from, the UI default selection is built from both country and tag candidates. Auto node group type order, tag-pool metadata, key generation, marker parsing and canonical key validation live in `@uni-conf/shared`, so backend sync, strategy-group preferences and frontend forms all use the same canonical `country:{ISO2}:{type}` / `tag:{key}:{type}` format. Product UI presents this pair as one “node group” so users do not maintain a separate collection-to-policy relationship. Generated collections are managed only through auto node group settings: the generic collection API rejects edits or deletes for collections whose notes start with `[uni-conf:auto-node-group]` or `[uni-conf:default-node-pool]`, and it also rejects user-created collections that try to use those reserved markers.
Web auto-node settings helpers return `AppSettingsPatch` fragments rather than normalized `AppSettings` responses, so UI code can preserve write-only meanings such as `NULL` restoring the zero-setup generated-key default.

| Generated group | Collection filter | Used first by |
|-----------------|-------------------|---------------|
| `{flag?} {countryCode} Auto/Select/Fallback` | `countryCode equals {countryCode}` + `tag not_in ["high-multiplier"]` | Country-aware routing preferences |
| `Streaming Auto/Select/Fallback` | `tag in ["streaming", "unlock"]` + `tag not_in ["high-multiplier"]` | Streaming |
| `Native Auto/Select/Fallback` | `tag in ["residential", "native-ip"]` + `tag not_in ["high-multiplier"]` | AI, Streaming |

Auto node group sync runs through the zero-setup initializer after subscription refreshes, manual node changes, node group reads/writes, and auto node group setting changes. The node group page persists the user's selected generated keys; selecting nothing disables generated auto groups so the backend does not recreate them on the next sync.

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

`collectionNodeNames` is built from the rewritten names, so node-backed outlet groups reference the same names that appear in the exported `proxies` / `outbounds` list. If export-wide dedupe removes a duplicate node row, collections that referenced the removed row are remapped through the same full-config dedupe key to the retained exported node name instead of becoming empty.

### ClientCompatibility (stored in `rules.compatibility`)
```json
[
  { "client": "mihomo", "level": "full" },
  { "client": "surge", "level": "partial", "note": "Surge only has partial GEOSITE support" }
]
```

`rules.compatibility` is not user-authored. Rule creation and batch import derive it from the shared rule compatibility matrix so API responses, forms, and preview validation stay aligned. The matrix reflects UniConf's current exporter capability; a client feature remains `unsupported` when UniConf cannot render all required sections for it. For example, `SCRIPT` rules are not treated as supported for Surge or Quantumult X until their exporters generate the matching script definitions. Remote rule set format support and preset URL resolution are also centralized in `@uni-conf/shared`; the web compatibility UI, worker preview validation, and client generators use the same matrix and resolver. Preview validation still recomputes target-format warnings at export time and is the authoritative check for the selected client.

### Export Preview Warnings

`GET /api/export/preview/:format` returns `warnings: CompatibilityWarning[]` alongside the generated content.

Preview, authenticated download, and public subscription rendering all call `apps/worker/src/generators/export-renderer.ts`, so every export format uses the same content generation and content-type mapping across entry points. The export renderer has a smoke-test matrix over `EXPORT_SUBSCRIPTION_FORMATS`, including Mihomo/Clash, sing-box, Loon, Surge, Shadowrocket, Quantumult X, Stash, Egern, and node-only raw/base64 subscriptions. This keeps Dashboard quick links, authenticated downloads, and public subscription filenames aligned with the shared format registry when a client format is added or removed.

Dashboard quick-export links use the shared canonical filename registry for URLs and `export.formats.*` i18n labels for display names. The web i18n test checks every quick-export format has labels in both Chinese and English, so adding a new dashboard export target cannot silently show an untranslated or hard-coded client label in the zero-setup flow.

The web export list uses the preview endpoint as its one-click validation path. It does not maintain a separate local validator: card-level validation summarizes the returned warnings by `unsupported`, `partial`, and `convert`, shows whether the config is usable, and links the user toward the full preview page for complete content and warning details.

The worker separates readiness checks from client compatibility checks. Readiness warnings are always returned because they indicate a config that may be empty or structurally broken. A target client with zero renderable nodes is a readiness warning, not a hideable compatibility warning, because download/subscription would be blocked. The `show_compatibility_warnings` setting only hides client capability warnings such as DNS downgrade, per-node protocol skip details, or rule-format support.

Preview also performs a lightweight download reachability check for enabled remote rule sets that the selected export format can actually reference. The worker tries `HEAD` first and falls back to a ranged `GET` when a host does not support `HEAD`; failures, timeouts, or non-success statuses are returned as `unsupported` warnings. Node-only subscription formats skip this network check because they do not render rule providers.

Authenticated download and public subscription responses block cases that cannot produce a usable client config: zero exported nodes, a selected target client for which every exported node protocol is unsupported, or structural readiness errors such as missing nested policy groups, missing rule/remote-rule targets, policy groups pointing at final node names that will not be emitted, or remote rule set URLs that are not downloadable `http(s)` addresses. Node-only subscription exports (`nodes_raw` / `nodes_base64`) use the final subscription URI serializer for this check, so a node with a supported protocol but missing required URI fields is treated as not renderable. Source refresh errors and remote rule-set network reachability failures remain preview warnings rather than hard download blockers when the already-materialized graph is otherwise renderable. Preview still returns generated content plus warnings so users can inspect why the export is empty, structurally broken, or protocol-filtered; download/subscription return HTTP 409 instead of handing clients a blank or dangling config.

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
| Remote rule set URL cannot be fetched during preview | `unsupported` |
| DNS mode cannot be fully represented by target export format | `partial` |
| MATCH not last | `partial` |

If no enabled `MATCH` rule exists, exporters append the fallback policy automatically and preview does not warn; this is the normal zero-setup path. `partial` warnings are still exported with an automatic fallback or compatibility caveat. `unsupported` warnings indicate a configuration problem that may break the target client.

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
