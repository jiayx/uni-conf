import { describe, expect, it } from 'vitest';
import * as yaml from 'js-yaml';
import type { ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types';
import { generateMihomoYaml } from './mihomo';
import { generateSingboxJson } from './singbox';
import { generateEgern, generateQuantumultX, generateShadowrocket, generateStashYaml, generateSurge } from './client-configs';
import { generateLoon } from './loon';

const createdAt = '2026-01-01T00:00:00.000Z';

const proxyGroup: ProxyGroup = {
  id: 'group-proxy',
  name: 'PROXY',
  type: 'select',
  collectionIds: [],
  groupIds: [],
  builtins: ['DIRECT'],
  enabled: true,
  order: 0,
  isBuiltin: false,
  createdAt,
  updatedAt: createdAt,
};

const directGroup: ProxyGroup = {
  ...proxyGroup,
  id: 'group-direct',
  name: 'DIRECT-GROUP',
  type: 'direct',
  builtins: [],
};

const matchRule: ProxyRule = {
  id: 'rule-match',
  type: 'MATCH',
  payload: '',
  targetGroupId: proxyGroup.id,
  enabled: true,
  order: 999,
  compatibility: [],
  createdAt,
  updatedAt: createdAt,
};

const geositeRule: ProxyRule = {
  ...matchRule,
  id: 'rule-geosite-google',
  type: 'GEOSITE',
  payload: 'google',
  targetGroupId: proxyGroup.id,
  order: 10,
};

const processPathRule: ProxyRule = {
  ...matchRule,
  id: 'rule-process-path',
  type: 'PROCESS-PATH',
  payload: '/Applications/Example.app',
  targetGroupId: proxyGroup.id,
  order: 11,
};

const scriptRule: ProxyRule = {
  ...matchRule,
  id: 'rule-script',
  type: 'SCRIPT',
  payload: 'script-path',
  targetGroupId: proxyGroup.id,
  order: 12,
};

const remoteSet: RemoteRuleSet = {
  id: 'remote-ads',
  name: 'Ads List',
  url: 'https://example.com/ads.yaml',
  format: 'mihomo',
  behavior: 'classical',
  sourceOverrides: {},
  targetGroupId: directGroup.id,
  updateInterval: 12,
  enabled: true,
  sortOrder: 20,
  createdAt,
  updatedAt: createdAt,
};

const singboxRemoteSet: RemoteRuleSet = {
  ...remoteSet,
  id: 'remote-singbox',
  name: 'AI SRS',
  url: 'https://example.com/ai.srs',
  format: 'singbox',
};

const quixoticPresetSet: RemoteRuleSet = {
  ...remoteSet,
  id: 'remote-quixotic-ai',
  name: 'AI',
  url: 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset/meta/ai.list',
  format: 'mihomo',
  presetSource: 'quixotic',
  presetId: 'ai',
};

const groupRows: Record<string, unknown>[] = [
  {
    id: proxyGroup.id,
    name: proxyGroup.name,
    type: proxyGroup.type,
    group_ids: '[]',
    builtins: '["DIRECT"]',
    enabled: 1,
    test_url: 'http://www.gstatic.com/generate_204',
    interval: 300,
  },
  {
    id: directGroup.id,
    name: directGroup.name,
    type: directGroup.type,
    group_ids: '[]',
    builtins: '[]',
    enabled: 1,
    test_url: 'http://www.gstatic.com/generate_204',
    interval: 300,
  },
];

const ruleRows: Record<string, unknown>[] = [
  ruleRow(matchRule),
];

function ruleRow(rule: ProxyRule): Record<string, unknown> {
  return {
    id: rule.id,
    type: rule.type,
    payload: rule.payload,
    target_group_id: rule.targetGroupId,
    enabled: rule.enabled ? 1 : 0,
    no_resolve: rule.noResolve ? 1 : 0,
  };
}

describe('remote rule set generators', () => {
  it('routes Mihomo remote rule sets before MATCH', () => {
    const content = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [remoteSet]);

    expect(content).toContain('Ads_List:');
    expect(content).toContain('behavior: classical');
    expect(content).toContain('url: "https://example.com/ads.yaml"');
    expect(content).toContain('  - RULE-SET,Ads_List,DIRECT');
    expect(content.indexOf('  - RULE-SET,Ads_List,DIRECT')).toBeLessThan(
      content.indexOf('  - MATCH,PROXY')
    );
    expect(content).not.toContain('ai.srs');
  });

  it('orders remote rule sets by managed sort order across full-config exporters', () => {
    const laterRemoteSet: RemoteRuleSet = {
      ...remoteSet,
      id: 'remote-later',
      name: 'Later List',
      url: 'https://example.com/later.yaml',
      sortOrder: 80,
      createdAt: '2026-01-02T00:00:00.000Z',
    };
    const earlierRemoteSet: RemoteRuleSet = {
      ...remoteSet,
      id: 'remote-earlier',
      name: 'Earlier List',
      url: 'https://example.com/earlier.yaml',
      sortOrder: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const mihomo = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [laterRemoteSet, earlierRemoteSet]);
    expect(mihomo.indexOf('  - RULE-SET,Earlier_List,DIRECT')).toBeLessThan(
      mihomo.indexOf('  - RULE-SET,Later_List,DIRECT')
    );

    const laterSingboxRemoteSet: RemoteRuleSet = {
      ...laterRemoteSet,
      format: 'singbox',
      url: 'https://example.com/later.srs',
    };
    const earlierSingboxRemoteSet: RemoteRuleSet = {
      ...earlierRemoteSet,
      format: 'singbox',
      url: 'https://example.com/earlier.srs',
    };
    const singbox = JSON.parse(generateSingboxJson([], [proxyGroup, directGroup], [matchRule], [laterSingboxRemoteSet, earlierSingboxRemoteSet])) as {
      route: { rules: Array<Record<string, unknown>> };
    };
    const remoteRouteRules = singbox.route.rules.filter((rule) => Array.isArray(rule['rule_set']));
    expect(remoteRouteRules.slice(-2)).toEqual([
      { rule_set: ['Earlier_List'], outbound: 'direct' },
      { rule_set: ['Later_List'], outbound: 'direct' },
    ]);

    const surge = generateSurge([], groupRows, ruleRows, [
      {
        id: 'remote-later',
        name: 'Later List',
        url: 'https://example.com/later.yaml',
        format: 'surge',
        enabled: 1,
        target_group_id: directGroup.id,
        update_interval: 24,
        sort_order: 80,
        created_at: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'remote-earlier',
        name: 'Earlier List',
        url: 'https://example.com/earlier.yaml',
        format: 'surge',
        enabled: 1,
        target_group_id: directGroup.id,
        update_interval: 24,
        sort_order: 10,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(surge.indexOf('RULE-SET,https://example.com/earlier.yaml,DIRECT')).toBeLessThan(
      surge.indexOf('RULE-SET,https://example.com/later.yaml,DIRECT')
    );
  });

  it('uses explicit Mihomo rule-provider behavior for plain domain lists', () => {
    const content = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [
      {
        ...remoteSet,
        name: 'Telegram Domains',
        url: 'https://example.com/telegram.list',
        format: 'text',
        behavior: 'domain',
      },
    ]);

    expect(content).toContain('Telegram_Domains:');
    expect(content).toContain('behavior: domain');
    expect(content).toContain('url: "https://example.com/telegram.list"');
  });

  it('uses PROXY when a final rule is not configured', () => {
    const mihomo = generateMihomoYaml([], [proxyGroup], [], []);
    expect(mihomo).toContain('  - MATCH,PROXY');

    const singbox = JSON.parse(generateSingboxJson([], [proxyGroup], [], [])) as {
      route: { final: string };
    };
    expect(singbox.route.final).toBe('PROXY');
  });

  it('routes sing-box remote rule sets and uses MATCH as final outbound', () => {
    const content = generateSingboxJson([], [proxyGroup, directGroup], [matchRule], [singboxRemoteSet]);
    const config = JSON.parse(content) as {
      route: {
        rules: Array<Record<string, unknown>>;
        rule_set: Array<Record<string, unknown>>;
        final: string;
      };
    };

    expect(config.route.rule_set).toContainEqual(
      expect.objectContaining({
        tag: 'AI_SRS',
        url: 'https://example.com/ai.srs',
      })
    );
    expect(config.route.rules).toContainEqual({
      rule_set: ['AI_SRS'],
      outbound: 'direct',
    });
    expect(config.route.final).toBe('PROXY');
  });

  it('declares sing-box geosite rule sets used by manual GEOSITE rules', () => {
    const content = generateSingboxJson([], [proxyGroup, directGroup], [geositeRule, matchRule], []);
    const config = JSON.parse(content) as {
      route: {
        rules: Array<Record<string, unknown>>;
        rule_set: Array<Record<string, unknown>>;
      };
    };

    expect(config.route.rules).toContainEqual({
      rule_set: ['geosite-google'],
      outbound: 'PROXY',
    });
    expect(config.route.rule_set).toContainEqual(expect.objectContaining({
      tag: 'geosite-google',
      url: 'https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-google.srs',
      download_detour: 'PROXY',
    }));
    expect(config.route.rule_set.filter((item) => item.tag === 'geosite-cn')).toHaveLength(1);

    const withDuplicateRemote = JSON.parse(generateSingboxJson([], [proxyGroup, directGroup], [geositeRule, matchRule], [{
      ...singboxRemoteSet,
      name: 'geosite-google',
    }])) as {
      route: { rule_set: Array<Record<string, unknown>> };
    };
    expect(withDuplicateRemote.route.rule_set.filter((item) => item.tag === 'geosite-google')).toHaveLength(1);
  });

  it('skips incompatible remote rule set formats per exporter', () => {
    const mihomo = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [singboxRemoteSet]);
    expect(mihomo).not.toContain('ai.srs');

    const singbox = generateSingboxJson([], [proxyGroup, directGroup], [matchRule], [remoteSet]);
    const config = JSON.parse(singbox) as { route: { rule_set: Array<Record<string, unknown>> } };
    expect(config.route.rule_set.some(item => item['url'] === remoteSet.url)).toBe(false);
  });

  it('references token-scoped conversion endpoints when an exact container conversion is available', () => {
    const conversionBaseUrl = 'https://config.example.com/sub/public-token/rules';
    const singbox = generateSingboxJson(
      [], [proxyGroup, directGroup], [matchRule], [remoteSet], {}, { ruleSetConversionBaseUrl: conversionBaseUrl }
    );
    const singboxConfig = JSON.parse(singbox) as { route: { rule_set: Array<Record<string, unknown>> } };
    expect(singboxConfig.route.rule_set).toContainEqual(expect.objectContaining({
      tag: 'Ads_List',
      format: 'source',
      url: `${conversionBaseUrl}/remote-ads/singbox.json`,
    }));

    const mihomo = generateMihomoYaml(
      [], [proxyGroup, directGroup], [matchRule], [singboxRemoteSet], {}, { ruleSetConversionBaseUrl: conversionBaseUrl }
    );
    expect(mihomo).toContain(`${conversionBaseUrl}/remote-singbox/mihomo.yaml`);

    const quantumultx = generateQuantumultX(
      [],
      [proxyGroup, directGroup] as unknown as Record<string, unknown>[],
      [matchRule] as unknown as Record<string, unknown>[],
      [singboxRemoteSet] as unknown as Record<string, unknown>[],
      {},
      { ruleSetConversionBaseUrl: conversionBaseUrl }
    );
    expect(quantumultx).toContain(`${conversionBaseUrl}/remote-singbox/quantumultx.list`);
  });

  it('keeps Clash and Stash target-native sources distinct from Mihomo sources', () => {
    const clientSpecificSet: RemoteRuleSet = {
      ...singboxRemoteSet,
      sourceOverrides: {
        mihomo: 'https://example.com/mihomo.yaml',
        clash: 'https://example.com/clash.yaml',
        stash: 'https://example.com/stash.yaml',
      },
    };

    const clash = generateMihomoYaml(
      [], [proxyGroup, directGroup], [matchRule], [clientSpecificSet], {}, { ruleSetExportFormat: 'clash' }
    );
    const stash = generateStashYaml(
      [], [proxyGroup, directGroup], [matchRule], [clientSpecificSet]
    );
    const mihomo = generateMihomoYaml(
      [], [proxyGroup, directGroup], [matchRule], [clientSpecificSet]
    );

    expect(clash).toContain('https://example.com/clash.yaml');
    expect(clash).not.toContain('https://example.com/mihomo.yaml');
    expect(stash).toContain('https://example.com/stash.yaml');
    expect(stash).not.toContain('https://example.com/mihomo.yaml');
    expect(mihomo).toContain('https://example.com/mihomo.yaml');
  });

  it('preserves Clash and Stash identity in shared Mihomo-container conversion URLs', () => {
    const conversionBaseUrl = 'https://config.example.com/sub/public-token/rules';

    const clash = generateMihomoYaml(
      [], [proxyGroup, directGroup], [matchRule], [singboxRemoteSet], {},
      { ruleSetConversionBaseUrl: conversionBaseUrl, ruleSetExportFormat: 'clash' }
    );
    const stash = generateStashYaml(
      [], [proxyGroup, directGroup], [matchRule], [singboxRemoteSet], {},
      { ruleSetConversionBaseUrl: conversionBaseUrl }
    );

    expect(clash).toContain(`${conversionBaseUrl}/remote-singbox/mihomo.yaml?for=clash`);
    expect(stash).toContain(`${conversionBaseUrl}/remote-singbox/mihomo.yaml?for=stash`);
  });

  it('resolves Quixotic presets to the current export format', () => {
    const singbox = generateSingboxJson([], [proxyGroup, directGroup], [matchRule], [quixoticPresetSet]);
    const config = JSON.parse(singbox) as { route: { rule_set: Array<Record<string, unknown>> } };

    expect(config.route.rule_set).toContainEqual(
      expect.objectContaining({
        tag: 'AI',
        format: 'binary',
        url: 'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/singbox/version5/ai.srs',
      })
    );

    const surge = generateSurge([], groupRows, ruleRows, [
      { ...quixoticPresetSet, preset_source: 'quixotic', preset_id: 'ai', target_group_id: directGroup.id },
    ]);
    expect(surge).toContain('RULE-SET,https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/surge/ai.list,DIRECT');
  });

  it('skips unsupported local rules for INI-style clients', () => {
    const surge = generateSurge([], groupRows, [ruleRow(geositeRule), ruleRow(scriptRule), ruleRow(matchRule)], []);
    const shadowrocket = generateShadowrocket([], groupRows, [ruleRow(geositeRule), ruleRow(scriptRule), ruleRow(matchRule)], []);

    expect(surge).toContain('GEOSITE,google,PROXY');
    expect(shadowrocket).not.toContain('GEOSITE,google,PROXY');
    expect(surge).not.toContain('SCRIPT');
    expect(shadowrocket).not.toContain('SCRIPT');
  });

  it('skips unsupported local rules for Quantumult X', () => {
    const quantumultx = generateQuantumultX([], groupRows, [ruleRow(scriptRule), ruleRow(matchRule)], []);

    expect(quantumultx).not.toContain('SCRIPT');
    expect(quantumultx).toContain('FINAL,PROXY');
  });

  it('skips unsupported local rules for Loon while keeping partial rules', () => {
    const loon = generateLoon([], groupRows, [ruleRow(geositeRule), ruleRow(processPathRule), ruleRow(matchRule)], []);

    expect(loon).toContain('GEOSITE, google, PROXY');
    expect(loon).not.toContain('PROCESS-PATH');
  });

  it('exports Stash as Mihomo-compatible YAML', () => {
    const content = generateStashYaml([], [proxyGroup, directGroup], [matchRule], [remoteSet]);
    expect(content).toContain('rule-providers:');
    expect(content).toContain('Ads_List:');
  });

  it('routes Surge remote rule sets and skips incompatible ones', () => {
    const content = generateSurge([], groupRows, ruleRows, [
      { ...remoteSet, format: 'surge', target_group_id: directGroup.id },
      { ...singboxRemoteSet, target_group_id: directGroup.id },
    ]);

    expect(content).toContain('RULE-SET,https://example.com/ads.yaml,DIRECT');
    expect(content).not.toContain('ai.srs');
  });

  it('routes Quantumult X remote rule sets through filter_remote', () => {
    const content = generateQuantumultX([], groupRows, ruleRows, [
      { ...remoteSet, format: 'quantumultx', target_group_id: directGroup.id },
    ]);

    expect(content).toContain('[filter_remote]');
    expect(content).toContain('https://example.com/ads.yaml, tag=Ads List, force-policy=DIRECT, enabled=true');
  });

  it('routes Egern remote rule sets in YAML', () => {
    const content = generateEgern([], groupRows, ruleRows, [
      { ...remoteSet, format: 'egern', target_group_id: directGroup.id },
    ]);

    const config = yaml.load(content) as { rules: Array<Record<string, unknown>> }
    expect(config.rules).toContainEqual({
      rule_set: {
        match: 'https://example.com/ads.yaml',
        policy: 'DIRECT',
        update_interval: 86400,
      },
    })
  });

  it('uses a custom target-native source override before automatic conversion', () => {
    const content = generateEgern([], groupRows, ruleRows, [{
      ...singboxRemoteSet,
      source_overrides: JSON.stringify({ egern: 'https://rules.example.com/native-egern.yaml' }),
      target_group_id: directGroup.id,
    }], {}, { ruleSetConversionBaseUrl: 'https://conf.example/sub/token/rules' })

    const config = yaml.load(content) as { rules: Array<Record<string, unknown>> }
    expect(config.rules).toContainEqual({
      rule_set: {
        match: 'https://rules.example.com/native-egern.yaml',
        policy: 'DIRECT',
        update_interval: 86400,
      },
    })
    expect(content).not.toContain('/sub/token/rules/')
  });

  it('routes incompatible Egern rule sets through the token-scoped converter', () => {
    const conversionBaseUrl = 'https://conf.example/sub/token/rules'
    const content = generateEgern([], groupRows, ruleRows, [
      { ...singboxRemoteSet, target_group_id: directGroup.id },
    ], {}, { ruleSetConversionBaseUrl: conversionBaseUrl })
    const config = yaml.load(content) as { rules: Array<Record<string, unknown>> }
    expect(config.rules).toContainEqual({
      rule_set: {
        match: `${conversionBaseUrl}/${singboxRemoteSet.id}/egern.yaml`,
        policy: 'DIRECT',
        update_interval: 86400,
      },
    })
  });
});
