import type { ExportDnsPolicy, ProxyNode, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types';
import {
  DEFAULT_HEALTH_CHECK,
  DEFAULT_RULE_TARGET_GROUP_ID,
  isRuleSetFormatCompatible,
  parseSingboxWireGuardEndpoint,
  parseRulePortPayload,
  resolveRuleForExport,
} from '@uni-conf/shared';
import { resolveRemoteRuleSetForExport } from './remote-rule-set-resolver';
import { DEFAULT_FAKE_IP_POLICY, realIpDomains } from './dns-policy';

// ─── sing-box JSON generator ──────────────────────────────────────────────────

interface SingboxGeneratorOptions {
  dnsPolicy?: ExportDnsPolicy;
  ruleSetConversionBaseUrl?: string;
}

export function generateSingboxJson(
  nodes: ProxyNode[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[],
  collectionNodeNames: Record<string, string[]> = {},
  options: SingboxGeneratorOptions = {}
): string {
  const dnsPolicy = options.dnsPolicy ?? DEFAULT_FAKE_IP_POLICY;
  const proxyDetour = defaultProxyDetour(groups);
  const serializedNodes = serializeSingboxNodes(nodes);
  const endpoints = serializedNodes.flatMap(item => item.endpoint ? [item.endpoint] : []);
  const config = {
    log: {
      level: 'warn',
      timestamp: true,
    },
    dns: buildDns(dnsPolicy, proxyDetour),
    inbounds: buildInbounds(),
    ...(endpoints.length > 0 ? { endpoints } : {}),
    outbounds: buildOutbounds(serializedNodes, groups, collectionNodeNames),
    route: buildRoute(rules, groups, remoteSets, proxyDetour, options.ruleSetConversionBaseUrl),
    experimental: {
      cache_file: {
        enabled: true,
        path: 'cache.db',
        cache_id: 'uni-conf',
        store_fakeip: dnsPolicy.address.mode === 'fake-ip',
      },
    },
  };

  return JSON.stringify(config, null, 2);
}

// ─── DNS ──────────────────────────────────────────────────────────────────────

function buildDns(policy: ExportDnsPolicy, proxyDetour: string): object {
  const split = policy.resolution.mode === 'split';
  const fakeIp = policy.address.mode === 'fake-ip';
  const servers: Record<string, unknown>[] = [
    {
      type: 'https',
      tag: 'localDns',
      server: '223.5.5.5',
      path: '/dns-query',
      detour: 'direct',
    },
  ];
  if (split) {
    servers.unshift({
      type: 'tls',
      tag: 'proxyDns',
      server: '8.8.8.8',
      detour: proxyDetour,
    });
  }
  if (fakeIp) {
    servers.push({
      type: 'fakeip',
      tag: 'fakeip',
      inet4_range: '198.18.0.0/15',
      inet6_range: 'fc00::/18',
    });
  }

  const rules: Record<string, unknown>[] = [];
  for (const domain of realIpDomains(policy)) {
    rules.push({
      ...(domain.startsWith('*.')
        ? { domain_suffix: domain.slice(2) }
        : { domain }),
      action: 'route',
      server: 'localDns',
    });
  }
  if (split) {
    rules.push({
      rule_set: 'geosite-cn',
      action: 'route',
      server: 'localDns',
    });
  }
  if (fakeIp) {
    rules.push({
      query_type: ['A', 'AAAA'],
      action: 'route',
      server: 'fakeip',
    });
  } else if (split) {
    rules.push({
      rule_set: 'geosite-geolocation-!cn',
      action: 'route',
      server: 'proxyDns',
    });
  }

  return {
    servers,
    ...(rules.length > 0 ? { rules } : {}),
    final: split ? 'proxyDns' : 'localDns',
    strategy: 'prefer_ipv4',
  };
}

// ─── Inbounds ─────────────────────────────────────────────────────────────────

function buildInbounds(): object[] {
  return [
    {
      type: 'tun',
      tag: 'tun-in',
      address: [
        '172.19.0.1/30',
        'fdfe:dcba:9876::1/126',
      ],
      mtu: 9000,
      auto_route: true,
      strict_route: true,
    },
    {
      type: 'mixed',
      tag: 'mixed-in',
      listen: '::',
      listen_port: 2080,
      set_system_proxy: false,
    },
  ];
}

// ─── Outbounds ────────────────────────────────────────────────────────────────

interface SerializedSingboxNode {
  node: ProxyNode;
  outbound?: object;
  endpoint?: object;
}

function serializeSingboxNodes(nodes: ProxyNode[]): SerializedSingboxNode[] {
  return nodes.flatMap<SerializedSingboxNode>((node) => {
    if (node.protocol === 'wireguard') {
      return [{ node, endpoint: nodeToWireGuardEndpoint(node) }];
    }
    const outbound = nodeToSingbox(node);
    return outbound ? [{ node, outbound }] : [];
  });
}

function buildOutbounds(
  serializedNodes: SerializedSingboxNode[],
  groups: ProxyGroup[],
  collectionNodeNames: Record<string, string[]>
): object[] {
  const outbounds: object[] = [];
  const serializableNodes = serializedNodes.map((item) => item.node);
  const serializableNodeNames = new Set(serializableNodes.map((node) => node.name));
  const serializableCollectionNodeNames = filterCollectionNodeNames(
    collectionNodeNames,
    serializableNodeNames
  );

  // Convert proxy nodes
  for (const { outbound } of serializedNodes) {
    if (outbound) outbounds.push(outbound);
  }

  // Convert groups (selectors/url-tests)
  for (const group of groups) {
    if (isNativeOutletGroup(group)) continue;
    const ob = groupToSingbox(group, serializableNodes, groups, serializableCollectionNodeNames);
    if (ob) outbounds.push(ob);
  }

  // Built-in outbounds
  outbounds.push({ type: 'direct', tag: 'direct' });

  return outbounds;
}

// ─── Node serialization ───────────────────────────────────────────────────────

function nodeToSingbox(node: ProxyNode): object | null {
  if (node.protocol === 'ssr' || node.protocol === 'wireguard') return null;
  const nativeOutbound = nativeSingboxOutbound(node);
  if (nativeOutbound) return nativeOutbound;

  const cfg = node.parsedConfig;
  const tag = node.name;

  switch (node.protocol) {
    case 'ss': {
      return {
        type: 'shadowsocks',
        tag,
        server: node.server,
        server_port: node.port,
        method: (cfg.extra?.cipher as string) ?? (cfg.extra?.method as string) ?? 'aes-256-gcm',
        password: cfg.password ?? '',
      };
    }
    case 'vmess': {
      const ob: Record<string, unknown> = {
        type: 'vmess',
        tag,
        server: node.server,
        server_port: node.port,
        uuid: cfg.uuid ?? '',
        alter_id: (cfg.extra?.alterId as number) ?? 0,
        security: (cfg.extra?.cipher as string) ?? (cfg.extra?.security as string) ?? 'auto',
      };
      if (cfg.tls) {
        ob.tls = {
          enabled: true,
          server_name: cfg.sni ?? node.server,
          insecure: cfg.skipCertVerify ?? false,
        };
      }
      if (cfg.network === 'ws') {
        ob.transport = {
          type: 'ws',
          path: cfg.wsPath ?? '/',
          headers: cfg.wsHeaders
            ? Object.fromEntries(Object.entries(cfg.wsHeaders))
            : {},
        };
      } else if (cfg.network === 'grpc') {
        ob.transport = {
          type: 'grpc',
          service_name: (cfg.extra?.grpcServiceName as string) ?? '',
        };
      }
      return ob;
    }
    case 'vless': {
      const ob: Record<string, unknown> = {
        type: 'vless',
        tag,
        server: node.server,
        server_port: node.port,
        uuid: cfg.uuid ?? '',
        flow: (cfg.extra?.flow as string) ?? '',
      };
      if (cfg.tls) {
        ob.tls = {
          enabled: true,
          server_name: cfg.sni ?? node.server,
          insecure: cfg.skipCertVerify ?? false,
        };
      }
      const reality = vlessRealityOptions(cfg.extra);
      if (reality) {
        const tls = (ob.tls ?? {}) as Record<string, unknown>;
        tls.reality = {
          enabled: true,
          public_key: reality.publicKey,
          short_id: reality.shortId,
        };
        ob.tls = tls;
      }
      return ob;
    }
    case 'trojan': {
      const ob: Record<string, unknown> = {
        type: 'trojan',
        tag,
        server: node.server,
        server_port: node.port,
        password: cfg.password ?? '',
        tls: {
          enabled: true,
          server_name: cfg.sni ?? node.server,
          insecure: cfg.skipCertVerify ?? false,
        },
      };
      return ob;
    }
    case 'hysteria2': {
      const ob: Record<string, unknown> = {
        type: 'hysteria2',
        tag,
        server: node.server,
        server_port: node.port,
        password: cfg.password ?? '',
        tls: {
          enabled: true,
          server_name: cfg.sni ?? node.server,
          insecure: cfg.skipCertVerify ?? false,
        },
      };
      const obfs = cfg.extra?.obfs as string | undefined;
      if (obfs) {
        ob.obfs = {
          type: obfs,
          password: (cfg.extra?.obfsPassword as string) ?? '',
        };
      }
      return ob;
    }
    case 'hysteria': {
      return {
        type: 'hysteria',
        tag,
        server: node.server,
        server_port: node.port,
        up_mbps: (cfg.extra?.upMbps as number) ?? 100,
        down_mbps: (cfg.extra?.downMbps as number) ?? 100,
        auth_str: cfg.password ?? (cfg.extra?.authStr as string) ?? (cfg.extra?.auth as string) ?? '',
        tls: {
          enabled: true,
          server_name: cfg.sni ?? node.server,
          insecure: cfg.skipCertVerify ?? false,
        },
      };
    }
    case 'tuic': {
      return {
        type: 'tuic',
        tag,
        server: node.server,
        server_port: node.port,
        uuid: cfg.uuid ?? '',
        password: cfg.password ?? '',
        congestion_control: (cfg.extra?.congestionControl as string) ?? 'bbr',
        tls: {
          enabled: true,
          server_name: cfg.sni ?? node.server,
          insecure: cfg.skipCertVerify ?? false,
        },
      };
    }
    case 'anytls': {
      const tls: Record<string, unknown> = {
        enabled: true,
        server_name: cfg.sni ?? node.server,
        insecure: cfg.skipCertVerify ?? false,
      };
      const fingerprint = anytlsFingerprint(cfg.extra);
      if (fingerprint) {
        tls.utls = { enabled: true, fingerprint };
      }
      const alpn = configStringArray(cfg.extra?.alpn);
      if (alpn.length > 0) tls.alpn = alpn;
      return {
        type: 'anytls',
        tag,
        server: node.server,
        server_port: node.port,
        password: cfg.password ?? '',
        tls,
      };
    }
    case 'shadowtls': {
      return {
        type: 'shadowtls',
        tag,
        server: node.server,
        server_port: node.port,
        password: cfg.password ?? '',
        tls: {
          enabled: true,
          server_name: cfg.sni ?? node.server,
          insecure: cfg.skipCertVerify ?? false,
        },
      };
    }
    case 'ssh': {
      const ob: Record<string, unknown> = {
        type: 'ssh',
        tag,
        server: node.server,
        server_port: node.port,
        user: (cfg.extra?.username as string) ?? 'root',
      };
      if (cfg.password) ob.password = cfg.password;
      return ob;
    }
    case 'socks5': {
      const ob: Record<string, unknown> = {
        type: 'socks',
        tag,
        server: node.server,
        server_port: node.port,
        version: '5',
      };
      if (cfg.extra?.username) ob.username = cfg.extra.username as string;
      if (cfg.password) ob.password = cfg.password;
      return ob;
    }
    case 'http':
    case 'https': {
      const ob: Record<string, unknown> = {
        type: 'http',
        tag,
        server: node.server,
        server_port: node.port,
      };
      if (cfg.extra?.username) ob.username = cfg.extra.username as string;
      if (cfg.password) ob.password = cfg.password;
      if (node.protocol === 'https' || cfg.tls) {
        ob.tls = {
          enabled: true,
          server_name: cfg.sni ?? node.server,
          insecure: cfg.skipCertVerify ?? false,
        };
      }
      return ob;
    }
    default:
      return null;
  }
}

function nodeToWireGuardEndpoint(node: ProxyNode): object {
  const cfg = node.parsedConfig;
  const extra = cfg.extra ?? {};
  const nativeEndpoint = parseSingboxWireGuardEndpoint(nativeObject(node.rawConfig, 'singboxEndpoint'));
  if (nativeEndpoint) {
    const rawPeers = nativeEndpoint.rawConfig.peers as Record<string, unknown>[];
    const primaryPeer = { ...rawPeers[0] };
    primaryPeer.address = node.server;
    primaryPeer.port = node.port;
    if (extra.publicKey !== undefined) primaryPeer.public_key = String(extra.publicKey);
    if (extra.presharedKey !== undefined) primaryPeer.pre_shared_key = String(extra.presharedKey);
    if (extra.reserved !== undefined) primaryPeer.reserved = extra.reserved;
    const allowedIps = configStringArray(extra.allowedIPs ?? extra.allowedIps ?? extra.allowed_ips);
    if (allowedIps.length > 0) primaryPeer.allowed_ips = allowedIps;

    return {
      ...nativeEndpoint.rawConfig,
      tag: node.name,
      address: wireguardLocalAddress(extra.ip ?? extra.address ?? nativeEndpoint.rawConfig.address),
      private_key: String(extra.privateKey ?? nativeEndpoint.rawConfig.private_key ?? ''),
      peers: [primaryPeer, ...rawPeers.slice(1).map(peer => ({ ...peer }))],
    };
  }

  const peer: Record<string, unknown> = {
    address: node.server,
    port: node.port,
    public_key: String(extra.publicKey ?? ''),
    allowed_ips: configStringArray(extra.allowedIPs ?? extra.allowedIps ?? extra.allowed_ips)
      .concat()
      .filter(Boolean),
  };
  if ((peer.allowed_ips as string[]).length === 0) peer.allowed_ips = ['0.0.0.0/0', '::/0'];
  if (extra.presharedKey) peer.pre_shared_key = String(extra.presharedKey);
  if (extra.reserved) peer.reserved = extra.reserved;

  return {
    type: 'wireguard',
    tag: node.name,
    address: wireguardLocalAddress(extra.ip ?? extra.address),
    private_key: String(extra.privateKey ?? ''),
    peers: [peer],
  };
}

function nativeSingboxOutbound(node: ProxyNode): Record<string, unknown> | null {
  const raw = nativeObject(node.rawConfig, 'singbox');
  if (!isSingboxOutboundShape(raw)) return null;
  return {
    ...raw,
    tag: node.name,
    server: node.server,
    server_port: node.port,
  };
}

function nativeObject(rawConfig: unknown, key: string): Record<string, unknown> | null {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return null;
  const raw = rawConfig as Record<string, unknown>;
  const nested = raw[key];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested as Record<string, unknown>;
  return raw;
}

function isSingboxOutboundShape(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return Boolean(value && typeof value.type === 'string' && value.server_port !== undefined && value.server !== undefined);
}

// ─── Group serialization ──────────────────────────────────────────────────────

function groupToSingbox(
  group: ProxyGroup,
  allNodes: ProxyNode[],
  allGroups: ProxyGroup[],
  collectionNodeNames: Record<string, string[]>
): object | null {
  const tag = group.name;
  const outbounds: string[] = [];

  for (const b of group.builtins) {
    const outbound = nativeSingboxOutboundFromBuiltin(b);
    if (outbound) outbounds.push(outbound);
  }

  for (const gid of group.groupIds) {
    const nestedGroup = allGroups.find((item) => item.id === gid);
    if (nestedGroup?.type === 'direct') outbounds.push('direct');
    else if (nestedGroup && nestedGroup.type !== 'reject') outbounds.push(resolveSingboxGroupName(nestedGroup));
  }

  const collectionNames = group.collectionIds.flatMap((id) => collectionNodeNames[id] ?? []);
  if (collectionNames.length > 0) {
    outbounds.push(...collectionNames);
  } else if (group.collectionIds.length === 0 && group.groupIds.length === 0 && group.builtins.length === 0) {
    outbounds.push(...allNodes.map((node) => node.name));
  }

  const dedupedOutbounds = [...new Set(outbounds)];
  if (dedupedOutbounds.length === 0) dedupedOutbounds.push('direct');

  switch (group.type) {
    case 'select':
      return {
        type: 'selector',
        tag,
        outbounds: dedupedOutbounds,
        default: dedupedOutbounds[0],
      };
    case 'url-test':
      return {
        type: 'urltest',
        tag,
        outbounds: dedupedOutbounds,
        url: group.testUrl ?? DEFAULT_HEALTH_CHECK.testUrl,
        interval: `${group.interval ?? DEFAULT_HEALTH_CHECK.interval}s`,
        tolerance: group.tolerance ?? DEFAULT_HEALTH_CHECK.tolerance,
      };
    case 'fallback':
      return {
        type: 'selector',
        tag,
        outbounds: dedupedOutbounds,
        default: dedupedOutbounds[0],
      };
    case 'load-balance':
      return {
        type: 'selector',
        tag,
        outbounds: dedupedOutbounds,
        default: dedupedOutbounds[0],
      };
    default:
      return null;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

function buildRoute(
  rules: ProxyRule[],
  groups: ProxyGroup[],
  remoteSets: RemoteRuleSet[],
  proxyDetour: string,
  ruleSetConversionBaseUrl?: string
): object {
  const routeRules: object[] = [];

  routeRules.push({
    action: 'sniff',
  });

  // Built-in DNS hijack
  routeRules.push({
    protocol: 'dns',
    action: 'hijack-dns',
  });

  // Convert rules
  const enabledRules = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order);
  const matchRule = enabledRules.find((r) => r.type === 'MATCH');

  for (const rule of enabledRules) {
    if (rule.type === 'MATCH') continue;
    const target = singboxRouteTarget(rule.targetGroupId, groups);
    const singboxRule = ruleToSingbox(rule, target);
    if (singboxRule) routeRules.push(singboxRule);
  }

  // Rule sets
  const ruleSets: object[] = [
    buildSingboxGeositeRuleSet('geosite-cn', proxyDetour),
    buildSingboxGeositeRuleSet('geosite-geolocation-!cn', proxyDetour),
  ];
  const ruleSetTags = new Set(['geosite-cn', 'geosite-geolocation-!cn']);

  for (const tag of collectGeositeRuleSetTags(enabledRules)) {
    if (ruleSetTags.has(tag)) continue;
    ruleSets.push(buildSingboxGeositeRuleSet(tag, proxyDetour));
    ruleSetTags.add(tag);
  }
  for (const tag of collectGeoipRuleSetTags(enabledRules)) {
    if (ruleSetTags.has(tag)) continue;
    ruleSets.push(buildSingboxGeoipRuleSet(tag, proxyDetour));
    ruleSetTags.add(tag);
  }

  const enabledRemoteSets = sortRemoteRuleSets(remoteSets)
    .filter((rs) => rs.enabled)
    .map((rs) => ({ source: rs, resolved: resolveRemoteRuleSetForExport(rs, 'singbox', ruleSetConversionBaseUrl) }))
    .filter((item): item is { source: RemoteRuleSet; resolved: { url: string; format: RemoteRuleSet['format']; converted?: boolean } } =>
      Boolean(item.resolved) && isRuleSetFormatCompatible('singbox', item.resolved!.format)
    );

  for (const { source: rs, resolved } of enabledRemoteSets) {
    const safeName = rs.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!ruleSetTags.has(safeName)) {
      ruleSets.push({
        tag: safeName,
        type: 'remote',
        format: resolved.format === 'singbox' && !resolved.converted ? 'binary' : 'source',
        url: resolved.url,
        download_detour: proxyDetour,
        update_interval: `${rs.updateInterval}h`,
      });
      ruleSetTags.add(safeName);
    }
    routeRules.push({
      rule_set: [safeName],
      ...singboxRouteTarget(rs.targetGroupId, groups),
    });
  }

  const finalTarget = matchRule
    ? singboxRouteTarget(matchRule.targetGroupId, groups)
    : { outbound: defaultPolicyName(groups) };
  if ('action' in finalTarget) routeRules.push(finalTarget);

  return {
    rules: routeRules,
    rule_set: ruleSets,
    ...('outbound' in finalTarget ? { final: finalTarget.outbound } : {}),
    auto_detect_interface: true,
    override_android_vpn: true,
    default_domain_resolver: 'localDns',
  };
}

function defaultPolicyName(groups: ProxyGroup[]): string {
  const group = groups.find((item) => item.id === DEFAULT_RULE_TARGET_GROUP_ID);
  return group ? resolveSingboxGroupName(group) : 'direct';
}

function defaultProxyDetour(groups: ProxyGroup[]): string {
  const proxyGroup = groups.find((item) => item.id === DEFAULT_RULE_TARGET_GROUP_ID);
  return proxyGroup ? resolveSingboxGroupName(proxyGroup) : defaultPolicyName(groups);
}

function sortRemoteRuleSets(remoteSets: RemoteRuleSet[]): RemoteRuleSet[] {
  return [...remoteSets].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

function collectGeositeRuleSetTags(rules: ProxyRule[]): string[] {
  return rules
    .filter((rule) => rule.enabled && rule.type === 'GEOSITE')
    .map((rule) => `geosite-${rule.payload.trim().toLowerCase()}`)
    .filter((tag) => tag !== 'geosite-');
}

function collectGeoipRuleSetTags(rules: ProxyRule[]): string[] {
  return rules
    .filter((rule) => rule.enabled && rule.type === 'GEOIP')
    .map((rule) => `geoip-${rule.payload.trim().toLowerCase()}`)
    .filter((tag) => tag !== 'geoip-');
}

function buildSingboxGeositeRuleSet(tag: string, proxyDetour: string): object {
  return {
    tag,
    type: 'remote',
    format: 'binary',
    url: `https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/${tag}.srs`,
    download_detour: proxyDetour,
    update_interval: '1d',
  };
}

function buildSingboxGeoipRuleSet(tag: string, proxyDetour: string): object {
  return {
    tag,
    type: 'remote',
    format: 'binary',
    url: `https://cdn.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/${tag}.srs`,
    download_detour: proxyDetour,
    update_interval: '1d',
  };
}

function filterCollectionNodeNames(
  collectionNodeNames: Record<string, string[]>,
  allowedNames: Set<string>
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(collectionNodeNames).map(([collectionId, names]) => [
      collectionId,
      names.filter((name) => allowedNames.has(name)),
    ])
  );
}

function resolveGroupName(groupId: string, groups: ProxyGroup[]): string {
  const group = groups.find((g) => g.id === groupId);
  return group ? resolveSingboxGroupName(group) : groupId;
}

function resolveSingboxGroupName(group: ProxyGroup): string {
  if (group.type === 'direct') return 'direct';
  return group.name;
}

function nativeSingboxOutboundFromBuiltin(name: string): string | null {
  return name === 'REJECT' ? null : 'direct';
}

function singboxRouteTarget(groupId: string, groups: ProxyGroup[]): { outbound: string } | { action: 'reject' } {
  const group = groups.find((item) => item.id === groupId);
  return group?.type === 'reject' ? { action: 'reject' } : { outbound: resolveGroupName(groupId, groups) };
}

function wireguardLocalAddress(value: unknown): string[] {
  const addresses = configStringArray(value);
  return addresses.length > 0 ? addresses : ['10.0.0.2/32'];
}

function configStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function vlessRealityOptions(extra: Record<string, unknown> | undefined): { publicKey: string; shortId: string } | null {
  if (!extra) return null;
  const nested = extra.reality && typeof extra.reality === 'object' && !Array.isArray(extra.reality)
    ? extra.reality as Record<string, unknown>
    : {};
  const publicKey = configString(extra.publicKey) ?? configString(nested.publicKey);
  const shortId = configString(extra.shortId) ?? configString(nested.shortId) ?? '';
  return publicKey ? { publicKey, shortId } : null;
}

function configString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function anytlsFingerprint(extra: Record<string, unknown> | undefined): string | undefined {
  return configString(extra?.['client-fingerprint'])
    ?? configString(extra?.clientFingerprint)
    ?? configString(extra?.fingerprint)
    ?? configString(extra?.fp);
}

function isNativeOutletGroup(group: ProxyGroup): boolean {
  return group.type === 'direct' || group.type === 'reject';
}

function ruleToSingbox(rule: ProxyRule, target: { outbound: string } | { action: 'reject' }): object | null {
  const resolution = resolveRuleForExport(rule.type, rule.payload, 'singbox');
  if (resolution.level === 'unsupported') return null;
  const payload = resolution.payload;
  switch (resolution.type) {
    case 'DOMAIN':
      return { domain: [payload], ...target };
    case 'DOMAIN-SUFFIX':
      return { domain_suffix: [payload], ...target };
    case 'DOMAIN-KEYWORD':
      return { domain_keyword: [payload], ...target };
    case 'DOMAIN-REGEX':
      return { domain_regex: [payload], ...target };
    case 'IP-CIDR':
      return { ip_cidr: [payload], ...target };
    case 'IP-CIDR6':
      return { ip_cidr: [payload], ...target };
    case 'GEOIP':
      return { rule_set: [`geoip-${payload.trim().toLowerCase()}`], ...target };
    case 'GEOSITE':
      return { rule_set: [`geosite-${payload.trim().toLowerCase()}`], ...target };
    case 'RULE-SET':
      return { rule_set: [payload.replace(/[^a-zA-Z0-9_-]/g, '_')], ...target };
    case 'PORT':
      return singboxPortMatch('port', payload, target);
    case 'SRC-PORT':
      return singboxPortMatch('source_port', payload, target);
    case 'SRC-IP-CIDR':
      return { source_ip_cidr: [payload], ...target };
    case 'PROCESS-NAME':
      return { process_name: [payload], ...target };
    case 'PROCESS-PATH':
      return { process_path: [payload], ...target };
    case 'PROTOCOL':
      return { protocol: [payload], ...target };
    case 'NETWORK':
      return { network: [payload], ...target };
    case 'MATCH':
      return target;
    default:
      return null;
  }
}

function singboxPortMatch(
  field: 'port' | 'source_port',
  payload: string,
  target: { outbound: string } | { action: 'reject' }
): object | null {
  const parsed = parseRulePortPayload(payload);
  if (!parsed) return null;
  return parsed.kind === 'single'
    ? { [field]: [parsed.port], ...target }
    : { [`${field}_range`]: [parsed.range], ...target };
}
