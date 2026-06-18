import type { ProxyNode, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types';

// ─── sing-box JSON generator ──────────────────────────────────────────────────

export function generateSingboxJson(
  nodes: ProxyNode[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[]
): string {
  const config = {
    log: {
      level: 'info',
      timestamp: true,
    },
    dns: buildDns(),
    inbounds: buildInbounds(),
    outbounds: buildOutbounds(nodes, groups),
    route: buildRoute(rules, groups, remoteSets),
    experimental: {
      cache_file: {
        enabled: true,
        path: 'cache.db',
        cache_id: 'uni-conf',
        store_fakeip: true,
      },
    },
  };

  return JSON.stringify(config, null, 2);
}

// ─── DNS ──────────────────────────────────────────────────────────────────────

function buildDns(): object {
  return {
    servers: [
      {
        tag: 'proxyDns',
        address: 'tls://8.8.8.8',
        detour: 'proxy',
      },
      {
        tag: 'localDns',
        address: 'https://223.5.5.5/dns-query',
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
    final: 'proxyDns',
    independent_cache: true,
    fakeip: {
      enabled: true,
      inet4_range: '198.18.0.0/15',
      inet6_range: 'fc00::/18',
    },
    strategy: 'prefer_ipv4',
  };
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

function buildOutbounds(nodes: ProxyNode[], groups: ProxyGroup[]): object[] {
  const outbounds: object[] = [];

  // Convert proxy nodes
  for (const node of nodes) {
    const ob = nodeToSingbox(node);
    if (ob) outbounds.push(ob);
  }

  // Convert groups (selectors/url-tests)
  for (const group of groups) {
    const ob = groupToSingbox(group, nodes);
    if (ob) outbounds.push(ob);
  }

  // Built-in outbounds
  outbounds.push({ type: 'direct', tag: 'direct' });
  outbounds.push({ type: 'block', tag: 'block' });
  outbounds.push({ type: 'dns', tag: 'dns-out' });

  return outbounds;
}

// ─── Node serialization ───────────────────────────────────────────────────────

function nodeToSingbox(node: ProxyNode): object | null {
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
        security: 'auto',
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
      const reality = cfg.extra?.reality as Record<string, unknown> | undefined;
      if (reality) {
        const tls = (ob.tls ?? {}) as Record<string, unknown>;
        tls.reality = {
          enabled: true,
          public_key: reality.publicKey ?? '',
          short_id: reality.shortId ?? '',
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
      return {
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
    }
    case 'hysteria': {
      return {
        type: 'hysteria',
        tag,
        server: node.server,
        server_port: node.port,
        up_mbps: (cfg.extra?.upMbps as number) ?? 100,
        down_mbps: (cfg.extra?.downMbps as number) ?? 100,
        auth_str: (cfg.extra?.authStr as string) ?? (cfg.extra?.auth as string) ?? '',
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
        local_address: (cfg.extra?.ip as string[]) ?? ['10.0.0.2/32'],
      };
    }
    default:
      return null;
  }
}

// ─── Group serialization ──────────────────────────────────────────────────────

function groupToSingbox(group: ProxyGroup, allNodes: ProxyNode[]): object | null {
  const tag = group.name;
  const outbounds: string[] = [];

  for (const b of group.builtins) {
    outbounds.push(b === 'DIRECT' ? 'direct' : 'block');
  }

  for (const gid of group.groupIds) {
    outbounds.push(gid);
  }

  // Simplified: add node names from all nodes if no specific collections
  if (group.collectionIds.length === 0 && group.groupIds.length === 0 && group.builtins.length === 0) {
    for (const node of allNodes.slice(0, 50)) {
      outbounds.push(node.name);
    }
  }

  if (outbounds.length === 0) outbounds.push('direct');

  switch (group.type) {
    case 'select':
      return {
        type: 'selector',
        tag,
        outbounds,
        default: outbounds[0],
      };
    case 'url-test':
      return {
        type: 'urltest',
        tag,
        outbounds,
        url: group.testUrl ?? 'http://www.gstatic.com/generate_204',
        interval: `${group.interval ?? 300}s`,
        tolerance: group.tolerance ?? 50,
      };
    case 'fallback':
      return {
        type: 'selector',
        tag,
        outbounds,
        default: outbounds[0],
      };
    case 'load-balance':
      return {
        type: 'selector',
        tag,
        outbounds,
        default: outbounds[0],
      };
    case 'direct':
      return { type: 'direct', tag };
    case 'reject':
      return { type: 'block', tag };
    default:
      return null;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

function buildRoute(
  rules: ProxyRule[],
  groups: ProxyGroup[],
  remoteSets: RemoteRuleSet[]
): object {
  const routeRules: object[] = [];

  // Built-in DNS hijack
  routeRules.push({
    protocol: 'dns',
    outbound: 'dns-out',
  });

  // Convert rules
  const enabledRules = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order);

  for (const rule of enabledRules) {
    const outbound = resolveGroupName(rule.targetGroupId, groups);
    const singboxRule = ruleToSingbox(rule, outbound);
    if (singboxRule) routeRules.push(singboxRule);
  }

  // Rule sets
  const ruleSets: object[] = [
    {
      tag: 'geosite-cn',
      type: 'remote',
      format: 'binary',
      url: 'https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs',
      download_detour: 'proxy',
      update_interval: '1d',
    },
    {
      tag: 'geosite-geolocation-!cn',
      type: 'remote',
      format: 'binary',
      url: 'https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-geolocation-!cn.srs',
      download_detour: 'proxy',
      update_interval: '1d',
    },
  ];

  for (const rs of remoteSets.filter((r) => r.enabled)) {
    const safeName = rs.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    ruleSets.push({
      tag: safeName,
      type: 'remote',
      format: rs.format === 'singbox' ? 'binary' : 'source',
      url: rs.url,
      download_detour: 'proxy',
      update_interval: `${rs.updateInterval}h`,
    });
  }

  const proxyGroup = groups.find((g) => g.name === 'PROXY') ?? groups[0];
  const finalOutbound = proxyGroup ? proxyGroup.name : 'direct';

  return {
    rules: routeRules,
    rule_set: ruleSets,
    final: finalOutbound,
    auto_detect_interface: true,
    override_android_vpn: true,
  };
}

function resolveGroupName(groupId: string, groups: ProxyGroup[]): string {
  const group = groups.find((g) => g.id === groupId);
  return group ? group.name : groupId;
}

function ruleToSingbox(rule: ProxyRule, outbound: string): object | null {
  switch (rule.type) {
    case 'DOMAIN':
      return { domain: [rule.payload], outbound };
    case 'DOMAIN-SUFFIX':
      return { domain_suffix: [rule.payload], outbound };
    case 'DOMAIN-KEYWORD':
      return { domain_keyword: [rule.payload], outbound };
    case 'DOMAIN-REGEX':
      return { domain_regex: [rule.payload], outbound };
    case 'IP-CIDR':
      return { ip_cidr: [rule.payload], outbound };
    case 'IP-CIDR6':
      return { ip_cidr: [rule.payload], outbound };
    case 'GEOIP':
      return { geoip: [rule.payload.toLowerCase()], outbound };
    case 'GEOSITE':
      return { rule_set: [`geosite-${rule.payload.toLowerCase()}`], outbound };
    case 'RULE-SET':
      return { rule_set: [rule.payload.replace(/[^a-zA-Z0-9_-]/g, '_')], outbound };
    case 'PORT':
      return { port: [parseInt(rule.payload, 10)], outbound };
    case 'PROCESS-NAME':
      return { process_name: [rule.payload], outbound };
    case 'MATCH':
      return { outbound };
    default:
      return null;
  }
}
