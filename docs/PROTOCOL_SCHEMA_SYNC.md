# Protocol Schema Sync Strategy

This document records how UniConf should keep proxy protocol fields aligned with mainstream clients.

## Current Baseline

As of 2026-06-19, the practical protocol baseline should be derived from:

- sing-box outbounds: `direct`, `block`, `socks`, `http`, `shadowsocks`, `vmess`, `trojan`, `wireguard`, `hysteria`, `vless`, `shadowtls`, `tuic`, `hysteria2`, `anytls`, `tor`, `ssh`, `dns`, `selector`, `urltest`, `naive`.
- mihomo proxy nodes: common proxy fields plus protocol-specific YAML objects such as `ss`, `ssr`, `vmess`, `vless`, `trojan`, `hysteria`, `hysteria2`, `tuic`, `wireguard`, `socks5`, `http`, `anytls`, and related TLS fields.

UniConf should not manually mirror every protocol field in `NormalizedProxyConfig`. That will drift as AnyTLS, REALITY, ECH, Hysteria2, TUIC, WireGuard, and transport fields evolve.

## Schema Sources

Use these sources as synchronization inputs:

| Target | Package / Source | Role |
| --- | --- | --- |
| sing-box | `@black-duty/sing-box-schema` | Zod schemas, JSON Schema, and generated TypeScript types for sing-box config. |
| mihomo | `meta-json-schema` | JSON Schema for Clash Meta / mihomo YAML config. |
| URI input | URI compatibility parser | Share links are not uniformly standardized, so URI parsing remains a compatibility layer shared by raw subscription parsing and manual node input. |

The schema packages should be dev/codegen inputs, not hand-copied into app code.

## Recommended Data Model

Keep the database columns as searchable indexes:

- `name`
- `protocol`
- `server`
- `port`
- `country`
- `country_code`
- `enabled`
- `tags`
- `notes`

Store client-native protocol fields as JSON:

```ts
type NodeConfigFormat = 'uri' | 'mihomo' | 'singbox' | 'unknown'

interface StoredNodeConfig {
  sourceFormat: NodeConfigFormat
  sourceUri?: string
  mihomo?: MihomoProxy
  singbox?: SingboxOutbound
  normalized: NormalizedProxyIndex
}

interface NormalizedProxyIndex {
  protocol: ProxyProtocol
  server: string
  port: number
  password?: string
  uuid?: string
  username?: string
  tls?: boolean
  sni?: string
  skipCertVerify?: boolean
  transport?: string
}
```

`normalized` is only for search, grouping, deduplication, and basic display. It is not the source of truth for protocol-specific exports.

## Type Generation

Add a codegen step that:

1. Loads sing-box outbound schemas/types from `@black-duty/sing-box-schema`.
2. Loads mihomo JSON Schema from `meta-json-schema/schemas/meta-json-schema.json`.
3. Generates checked TypeScript types into `packages/types/src/generated/`.
4. Generates a protocol field registry for the UI:
   - protocol name
   - required fields
   - optional fields
   - enum values
   - whether TLS fields apply
   - target support: `mihomo`, `singbox`, or both
   - native field paths for URI, mihomo, and sing-box mapping

The generated files should be committed if builds need to run without network access.
`@uni-conf/types` runs `check:protocols` as part of `build` and `typecheck`, so normal repo validation fails when the protocol registry references a sing-box or mihomo type that is missing from the generated upstream-schema metadata.

The field registry is used in three places:

- manual input forms
- URI/native config parsing and normalization
- client-specific export conversion

## Runtime Flow

URI/manual input:

1. Parse URI into a best-effort native object using the same compatibility parser for raw subscription lines and manual node creation.
2. Prefer a sing-box outbound object for protocols whose fields match sing-box more closely.
3. Also derive a mihomo object when lossless conversion is known.
4. Store both native objects when possible; otherwise store the one that is faithful.
5. Derive `normalized` from the native object.

Mihomo export:

- If `raw_config.mihomo` exists, emit it after applying the current node name and enabled state.
- Else convert from `raw_config.singbox` using explicit protocol adapters.
- Else fall back to `normalized` only for simple protocols.

sing-box export:

- If `raw_config.singbox` exists, emit it after applying the current node tag.
- Else convert from `raw_config.mihomo` using explicit protocol adapters.
- Else fall back to `normalized` only for simple protocols.

## Why This Shape

- It keeps AnyTLS, ShadowTLS, WireGuard, TUIC, Hysteria2, REALITY, ECH, and transport-specific fields synchronized with upstream schemas.
- It avoids expanding `nodes` table columns every time a protocol adds a field.
- It lets the UI render protocol-specific forms from generated metadata instead of hand-maintaining field lists.
- It preserves lossless import/export for users who paste native mihomo or sing-box nodes.

## Migration Path

1. Add generated type files and protocol registry.
2. Change manual node forms to render from the registry.
3. Change parsers to output `StoredNodeConfig` instead of only `NormalizedProxyConfig`.
4. Change exporters to prefer native config objects.
5. Store newly parsed or manually entered nodes in the current native-plus-normalized shape directly; UniConf is a new product and does not carry legacy node record compatibility branches.
