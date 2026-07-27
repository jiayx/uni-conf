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
- generator options such as address response, resolver routing, and real-IP exceptions when the client supports managed DNS

Use `apps/worker/src/generators/group-members.ts` for generic group member resolution when possible. For Mihomo-compatible YAML, remember that `DIRECT` and `REJECT` are client built-in policies; do not emit invalid `type: direct` or `type: reject` proxy-groups.

Full-config exporters should keep the zero-setup baseline aligned with the managed FakeIP policy. Address response (`fake-ip` / `real-ip`) and resolver routing (`single` / `split`) are independent axes; target adapters must not collapse them back into a combined mode enum. Mihomo-compatible configs, including the explicit `clash` export alias, use `mixed-port: 7890`, `mode: rule`, `allow-lan: false`, and `log-level: warning`; sing-box uses `log.level = warning` with its managed DNS and inbound baseline. Do not reintroduce separate Mihomo `port` / `socks-port` / `redir-port` defaults unless the product adds an explicit advanced port profile.

Every full-config exporter must emit a usable fallback route when the data has no enabled `MATCH` / `FINAL` rule. Disabled fallback rows do not count. Use `漏网之鱼` when present, otherwise `PROXY`, then the first available policy, then the client's direct policy. This applies to YAML, JSON, INI-style clients, Quantumult X, and Egern alike; a generated full config must not end with an empty rule list.

Full-config generators must sort remote rule sets by managed priority before rendering rule-provider references and rules. Do not rely only on database query order; preview, download, public subscription, and direct generator tests should produce the same rule order for the same data.

## Step 3: Wire Preview, Download, and Public Subscription

Add the format branch in `apps/worker/src/generators/export-renderer.ts`. Worker routes must call that shared renderer instead of branching per route:

- `apps/worker/src/routes/export.ts`
- `apps/worker/src/routes/subscription.ts`

Preview, download, and public subscription paths must use the same generator semantics. Any proxy name rewrite, dedupe, node group scoping, DNS downgrade, or compatibility warning should be visible in preview before download and public subscription use.

UI scope summaries should describe the same effective export graph that the worker will render. When an export config scopes policy groups, summary counts for manual rules and remote rule sets must expand the selected group graph and exclude rules whose target group is outside that final group set, matching `buildExportData` filtering.

Node-only exports (`nodes_raw` and `nodes_base64`) intentionally skip policy group, local rule, remote rule set, and DNS validation because those sections are not rendered. They should still validate source readiness, empty node output, duplicate node names, and whether each node protocol can be represented as a subscription URI.

Every full-config exporter must expand collection-backed policy groups through `collectionNodeNames` and then filter those members against the nodes actually serialized by that exporter. This prevents generated groups from pointing at missing proxies/outbounds and keeps Mihomo, Stash, sing-box, Loon, Surge, Shadowrocket, Quantumult X, and Egern aligned when the same node pool is used by default global outlets or auto node groups.

Client profile syntax and generic subscription URI syntax are separate contracts. In particular, Quantumult X `[server_local]` entries must use its native `protocol=host:port, ..., tag=name` form; do not reuse `nodeToSubscriptionUri` there. Only advertise a protocol in `EXPORT_CLIENT_CAPABILITIES.quantumultx.nodeProtocols` after a native serializer and artifact-contract test exist. Surge external rule sets belong directly in `[Rule]` as `RULE-SET,https://...,Policy`; do not invent a separate named `[Rule Set]` registry. Increment `EXPORT_CAPABILITY_PROFILE_REVISION` whenever an externally visible capability or serializer contract changes.

For the stable sing-box 1.13 profile, use top-level WireGuard `endpoints`, TUN `address`, route `sniff` actions, and `route.default_domain_resolver` for internal outbound/endpoint hostname resolution. DNS routing rules use explicit `action: route`. Keep the exporter and its bundled schema aligned to the same stable sing-box profile.

The bundled 1.13.13 schema does not expose a ShadowsocksR outbound, so SSR nodes are omitted from sing-box artifacts with an explicit compatibility warning. They remain available to Mihomo, Loon, Quantumult X, and node-subscription serializers that still implement SSR. WireGuard is supported by sing-box through top-level `endpoints`.

Do not share a lowest-common-denominator proxy-line serializer between Surge and Shadowrocket. Surge HTTPS is a native `https` type rather than `http, ..., tls=true`; HTTP(S) and SOCKS5 credentials are positional, while VMess, Trojan, AnyTLS, and Hysteria 2 use their documented named parameters. Every protocol listed in the Surge capability registry must have a protocol-matrix test that validates the complete rendered artifact.

Loon is another independent profile grammar. Its SS/SSR, VMess/VLESS, Trojan/Hysteria 2, and HTTP(S) identity fields are positional, followed by documented `key=value` transport options. Reject unsupported transports explicitly; never relabel gRPC or another transport as TCP merely to keep the node in the output. A protocol being accepted by Loon's subscription importer is not evidence that an invented line belongs in `[Proxy]`.

Egern YAML is not Clash-style flat YAML. Each proxy, policy group, and rule must be wrapped by exactly one native type key, for example `shadowsocks: { ... }`, `select: { ... }`, or `domain: { ... }`; the fallback rule is `default: { policy: ... }`. Keep Egern protocol and transport capabilities independent from the other YAML exporters.

Target the stable sing-box contract explicitly: TUN addresses use one `address` array and WireGuard nodes are top-level `endpoints` with peer objects. Endpoint tags participate in selector, route-rule, and final-route reference validation just like outbound tags. Protocol-matrix tests must pass both UniConf's graph validator and the bundled stable sing-box schema.

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

| Rule Type | Mihomo | sing-box | Loon | Surge | Shadowrocket | QX | Egern |
|-----------|--------|---------|------|-------|-------------|-----|-------|
| DOMAIN | Full | Full | Full | Full | Full | Full | Full |
| DOMAIN-SUFFIX | Full | Full | Full | Full | Full | Full | Full |
| DOMAIN-KEYWORD | Full | Full | Full | Full | Full | Full | Full |
| IP-CIDR | Full | Full | Full | Full | Full | Full | Full |
| GEOIP | Full | Full | Full | Full | Full | Full | Full |
| GEOSITE | Full | Full | Partial | Partial | Unsupported | Unsupported | Unsupported |
| PROCESS-NAME | Full | Full | Partial | Full | Unsupported | Unsupported | Unsupported |
| IP-ASN | Full | Unsupported | Full | Full | Partial | Unsupported | Full |
| PORT | Full | Full | Convert (`DEST-PORT`) | Convert (`DEST-PORT`) | Convert (`DST-PORT`) | Unsupported | Full |
| SRC-PORT | Full | Full | Full | Full | Unsupported | Unsupported | Unsupported |
| PROTOCOL | Payload-aware | Payload-aware | TCP/UDP | Payload-aware | Unsupported | Unsupported | Payload-aware |
| NETWORK | TCP/UDP | TCP/UDP/ICMP | Convert TCP/UDP | Convert TCP/UDP | Unsupported | Unsupported | Convert TCP/UDP |
| RULE-SET (manual directive) | Full | Full | Unsupported | Full | Partial | Unsupported | Full |
| SCRIPT | Partial | Unsupported | Partial | Unsupported | Unsupported | Unsupported | Unsupported |

Use the shared resolver for exact compatibility; the table summarizes its externally visible behavior. Internally, compatibility can be `full`, `partial`, `convert`, or `unsupported`, and value-dependent rules such as `PROTOCOL` and `NETWORK` may resolve differently per payload. The `RULE-SET` row is only about a manual rule directive: Loon `[Remote Rule]` and Quantumult X `[filter_remote]` resources remain supported through UniConf's dedicated remote-rule-set model. This matrix describes UniConf's current exporter behavior, not every feature a client may theoretically support. For example, `SCRIPT` stays unsupported for INI-style and Quantumult X exports until the generator can also emit the required client-specific script sections.
