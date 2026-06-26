# Adding a New Exporter to UniConf

This guide explains how to add support for a new proxy client format to UniConf.
Export generation is worker-owned: the web app calls worker preview/download APIs and should not maintain a second exporter implementation.

## Step 1: Add the Format Type

Add the new value to `ExportFormat` in `packages/types/src/index.ts`.

```ts
export type ExportFormat =
  | 'mihomo'
  | 'clash'
  | 'singbox'
  | 'loon'
  | 'surge'
  | 'quantumultx'
  | 'stash'
  | 'shadowrocket'
  | 'egern'
```

If the format has a subscription filename, also update `EXPORT_FORMAT_FILENAMES` and related helpers in `packages/shared/src/index.ts`.

## Step 2: Add the Worker Generator

Create or extend a generator in `apps/worker/src/generators/`.

The generator should accept:

- enabled nodes
- enabled policy groups
- enabled local rules
- enabled remote rule sets
- `collectionNodeNames`, so node-backed groups only include the nodes selected by their node group
- generator options such as DNS mode when the client supports managed DNS

Use `apps/worker/src/generators/group-members.ts` for generic group member resolution when possible. For Mihomo-compatible YAML, remember that `DIRECT` and `REJECT` are client built-in policies; do not emit invalid `type: direct` or `type: reject` proxy-groups.

## Step 3: Wire Preview, Download, and Public Subscription

Add the format branch in `apps/worker/src/generators/export-renderer.ts`. Worker routes must call that shared renderer instead of branching per route:

- `apps/worker/src/routes/export.ts`
- `apps/worker/src/routes/subscription.ts`

Preview, download, and public subscription paths must use the same generator semantics. Any proxy name rewrite, dedupe, node group scoping, DNS downgrade, or compatibility warning should be visible in preview before download and public subscription use.

## Step 4: Add Compatibility Rules

Update `RULE_COMPATIBILITY` in `packages/shared/src/index.ts`.

The web compatibility checker and the worker preview validator both consume this shared matrix. Do not add a second client-specific rule matrix in the web app.

If the client cannot represent a remote rule-set format, update the worker preview validation and generator skip behavior together.

## Step 5: Add UI Labels

Add the format label to:

- `apps/web/src/i18n/zh.json`
- `apps/web/src/i18n/en.json`
- export or preview format option lists where applicable

The UI should only select a format and display worker-generated output. It should not serialize nodes, groups, or rules locally.

## Step 6: Write Tests

Add focused worker tests for:

- node serialization
- group member references
- local rule output
- remote rule-set handling
- preview validation warnings
- unsupported node/protocol filtering

If UI compatibility behavior changes, also update the web compatibility tests. Snapshot-style checks are useful, but include structural assertions for references such as “every group member exists as a proxy, built-in policy, or emitted group”. Worker preview validation should also warn when a selected exporter cannot serialize a node protocol, when a node-backed policy group has no final exported nodes, or when its collection member names are not present in the final proxy / outbound list after filtering and renaming.

## Compatibility Matrix Reference

| Rule Type | Mihomo | sing-box | Loon | Surge | Shadowrocket | QX |
|-----------|--------|---------|------|-------|-------------|-----|
| DOMAIN | Full | Full | Full | Full | Full | Full |
| DOMAIN-SUFFIX | Full | Full | Full | Full | Full | Full |
| DOMAIN-KEYWORD | Full | Full | Full | Full | Full | Full |
| IP-CIDR | Full | Full | Full | Full | Full | Full |
| GEOIP | Full | Full | Full | Full | Full | Full |
| GEOSITE | Full | Full | Full | Unsupported | Unsupported | Unsupported |
| PROCESS-NAME | Full | Full | Partial | Full | Unsupported | Unsupported |
| RULE-SET | Full | Full | Full | Full | Full | Full |
| SCRIPT | Unsupported | Unsupported | Full | Full | Full | Full |

Use `full`, `partial`, and `unsupported` in code.
