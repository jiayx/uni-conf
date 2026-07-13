import type { DnsMode, ProxyNode, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types';
import { DEFAULT_HEALTH_CHECK, isRuleSetFormatCompatible } from '@uni-conf/shared';
import { resolveRemoteRuleSetForExport } from './remote-rule-set-resolver';

// ─── sing-box JSON generator ──────────────────────────────────────────────────

interface SingboxGeneratorOptions {
  dnsMode?: DnsMode;
}

export function generateSingboxJson(
  nodes: ProxyNode[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[],
  collectionNodeNames: Record<string, string[]> = {},
  options: SingboxGeneratorOptions = {}
): string {
  const dnsMode = options.dnsMode ?? 'smart';
  const proxyDetour = defaultProxyDetour(groups);
  const config = {
    log: {
      level: 'warn',
      timestamp: true,
    },
    dns: buildDns(dnsMode, proxyDetour),
    inbounds: buildInbounds(),
    outbounds: buildOutbounds(nodes, groups, collectionNodeNames),
    route: buildRoute(rules, groups, remoteSets, proxyDetour),
    experimental: {
      cache_file: {
        enabled: true,
        path: 'cache.db',
        cache_id: 'uni-conf',
        store_fakeip: dnsMode === 'fake-ip',
      },
    },
  };

  return JSON.stringify(config, null, 2);
}

// ─── DNS ──────────────────────────────────────────────────────────────────────

function buildDns(mode: DnsMode, proxyDetour: string): object {
  const dns: Record<string, unknown> = {
    servers: [
      {
        type: 'tls',
        tag: 'proxyDns',
        server: '8.8.8.8',
        detour: proxyDetour,
      },
      {
        type: 'https',
        tag: 'localDns',
        server: '223.5.5.5',
        path: '/dns-query',
        detour: 'direct',
      },
      {
        tag: 'blockDns',
        address: 'rcode://success',
      },
    ],
    rules: [
      {
        outbound: 'any',
        server: 'localDns',
      },
      {
        rule_set: 'geosite-cn',
        server: 'localDns',
      },
      {
        rule_set: 'geosite-geolocation-!cn',
        server: 'proxyDns',
      },
    ],
    final: mode === 'compatible' ? 'localDns' : 'proxyDns',
    independent_cache: true,
    strategy: 'prefer_ipv4',
  };

  if (mode === 'fake-ip') {
    dns.fakeip = {
      enabled: true,
      inet4_range: '198.18.0.0/15',
      inet6_range: 'fc00::/18',
    };
  }

  return dns;
}

// ─── Inbounds ─────────────────────────────────────────────────────────────────

function buildInbounds(): object[] {
  return [
    {
      type: 'tun',
      tag: 'tun-in',
      inet4_address: '172.19.0.1/30',
      inet6_address: 'fdfe:dcba:9876::1/126',
      mtu: 9000,
      auto_route: true,
      strict_route: true,
      sniff: true,
      sniff_override_destination: true,
    },
    {
      type: 'mixed',
      tag: 'mixed-in',
      listen: '::',
      listen_port: 2080,
      sniff: true,
      set_system_proxy: false,
    },
  ];
}

// ─── Outbounds ────────────────────────────────────────────────────────────────

function buildOutbounds(
  nodes: ProxyNode[],
  groups: ProxyGroup[],
  collectionNodeNames: Record<string, string[]>
): object[] {
  const outbounds: object[] = [];
  const serializedNodes = nodes
    .map((node) => ({ node, outbound: nodeToSingbox(node) }))
    .filter((item): item is { node: ProxyNode; outbound: object } => item.outbound !== null);
  const serializableNodes = serializedNodes.map((item) => item.node);
  const serializableNodeNames = new Set(serializableNodes.map((node) => node.name));
  const serializableCollectionNodeNames = filterCollectionNodeNames(
    collectionNodeNames,
    serializableNodeNames
  );

  // Convert proxy nodes
  for (const { outbound } of serializedNodes) {
    outbounds.push(outbound);
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
    case 'ssr': {
      return {
        type: 'shadowsocksr',
        tag,
        server: node.server,
        server_port: node.port,
        method: (cfg.extra?.cipher as string) ?? (cfg.extra?.method as string) ?? 'aes-256-cfb',
        password: cfg.password ?? '',
        protocol: (cfg.extra?.protocol as string) ?? 'origin',
        protocol_param: (cfg.extra?.protocolParam as string) ?? '',
        obfs: (cfg.extra?.obfs as string) ?? 'plain',
        obfs_param: (cfg.extra?.obfsParam as string) ?? '',
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
    case 'wireguard': {
      return {
        type: 'wireguard',
        tag,
        server: node.server,
        server_port: node.port,
        private_key: (cfg.extra?.privateKey as string) ?? '',
        peer_public_key: (cfg.extra?.publicKey as string) ?? '',
        pre_shared_key: (cfg.extra?.presharedKey as string) ?? '',
        reserved: (cfg.extra?.reserved as number[]) ?? [0, 0, 0],
        local_address: wireguardLocalAddress(cfg.extra?.ip ?? cfg.extra?.address),
      };
    }
    default:
      return null;
  }
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
  proxyDetour: string
): object {
  const routeRules: object[] = [];

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

  const enabledRemoteSets = sortRemoteRuleSets(remoteSets)
    .filter((rs) => rs.enabled)
    .map((rs) => ({ source: rs, resolved: resolveRemoteRuleSetForExport(rs, 'singbox') }))
    .filter((item): item is { source: RemoteRuleSet; resolved: { url: string; format: RemoteRuleSet['format'] } } =>
      Boolean(item.resolved) && isRuleSetFormatCompatible('singbox', item.resolved!.format)
    );

  for (const { source: rs, resolved } of enabledRemoteSets) {
    const safeName = rs.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!ruleSetTags.has(safeName)) {
      ruleSets.push({
        tag: safeName,
        type: 'remote',
        format: resolved.format === 'singbox' ? 'binary' : 'source',
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
  };
}

function defaultPolicyName(groups: ProxyGroup[]): string {
  const group = groups.find((item) => item.name === '漏网之鱼')
    ?? groups.find((item) => item.name === 'PROXY')
    ?? groups[0];
  return group ? resolveSingboxGroupName(group) : 'direct';
}

function defaultProxyDetour(groups: ProxyGroup[]): string {
  const proxyGroup = groups.find((item) => item.name === 'PROXY');
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
  if (Array.isArray(value)) {
    const addresses = value.map(String).map((item) => item.trim()).filter(Boolean);
    return addresses.length > 0 ? addresses : ['10.0.0.2/32'];
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return ['10.0.0.2/32'];
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
  switch (rule.type) {
    case 'DOMAIN':
      return { domain: [rule.payload], ...target };
    case 'DOMAIN-SUFFIX':
      return { domain_suffix: [rule.payload], ...target };
    case 'DOMAIN-KEYWORD':
      return { domain_keyword: [rule.payload], ...target };
    case 'DOMAIN-REGEX':
      return { domain_regex: [rule.payload], ...target };
    case 'IP-CIDR':
      return { ip_cidr: [rule.payload], ...target };
    case 'IP-CIDR6':
      return { ip_cidr: [rule.payload], ...target };
    case 'GEOIP':
      return { geoip: [rule.payload.toLowerCase()], ...target };
    case 'GEOSITE':
      return { rule_set: [`geosite-${rule.payload.toLowerCase()}`], ...target };
    case 'RULE-SET':
      return { rule_set: [rule.payload.replace(/[^a-zA-Z0-9_-]/g, '_')], ...target };
    case 'PORT':
      return { port: [parseInt(rule.payload, 10)], ...target };
    case 'PROCESS-NAME':
      return { process_name: [rule.payload], ...target };
    case 'MATCH':
      return target;
    default:
      return null;
  }
}
