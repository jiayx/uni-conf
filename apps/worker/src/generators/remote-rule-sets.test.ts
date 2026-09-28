import { describe, expect, it } from 'vitest';
import * as yaml from 'js-yaml';
import { DEFAULT_RULE_TARGET_GROUP_ID, resolveQuixoticRuleSetForExport } from '@uni-conf/shared';
import type { ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types';
import { generateMihomoYaml } from './mihomo';
import { generateSingboxJson } from './singbox';
import { generateEgern, generateQuantumultX, generateShadowrocket, generateStashYaml, generateSurge } from './client-configs';
import { generateLoon } from './loon';
import { resolveRuleSetConversionSource } from '../services/rule-set-conversion';
import { bundledRuleSetCatalogSnapshot } from '../generated/rule-set-catalogs';

const createdAt = '2026-01-01T00:00:00.000Z';

const proxyGroup: ProxyGroup = {
  id: DEFAULT_RULE_TARGET_GROUP_ID,
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
    sort_order: rule.order,
  };
}

describe('remote rule set generators', () => {
  it('exports the same CDN rule source across clients', () => {
    const row = { ...quixoticPresetSet, preset_source: 'quixotic', preset_id: 'ai', target_group_id: directGroup.id }
    const renders = [
      ['surge', generateSurge], ['loon', generateLoon], ['shadowrocket', generateShadowrocket],
      ['quantumultx', generateQuantumultX], ['egern', generateEgern],
    ] as const
    for (const [format, render] of renders) {
      const content = render([], groupRows, ruleRows, [row])
      const extension = format === 'egern' ? 'yaml' : 'list'
      expect(content).toContain(`https://testingcf.jsdelivr.net/gh/QuixoticHeart/rule-set@ruleset/${format}/ai.${extension}`)
      expect(content).not.toContain('raw.githubusercontent.com')
    }
    const stash = generateStashYaml([], [proxyGroup, directGroup], [matchRule], [quixoticPresetSet])
    expect(stash).toContain('https://testingcf.jsdelivr.net/gh/QuixoticHeart/rule-set@ruleset/stash/ai.list')
    expect(stash).not.toContain('raw.githubusercontent.com')
  });

  it('downloads Mihomo rule providers through the default proxy with CDN URLs while preserving routing targets', () => {
    const config = yaml.load(generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [quixoticPresetSet])) as {
      'rule-providers': Record<string, { proxy: string; url: string }>;
      rules: string[];
    };
    expect(config['rule-providers'].AI).toMatchObject({
      proxy: 'PROXY',
      url: 'https://testingcf.jsdelivr.net/gh/QuixoticHeart/rule-set@ruleset/meta/ai.list',
    });
    expect(config['rule-providers']['uni-conf-fake-ip-filter']).toMatchObject({
      proxy: 'PROXY',
      url: 'https://testingcf.jsdelivr.net/gh/QuixoticHeart/rule-set@ruleset/meta/domain/fake-ip-filter.mrs',
    });
    expect(config.rules).toContain('RULE-SET,AI,DIRECT');
  });

  it('uses the actual name of a workspace-scoped default group for Mihomo downloads', () => {
    const renamedGroup = { ...proxyGroup, id: `workspace-1:${DEFAULT_RULE_TARGET_GROUP_ID}`, name: 'My "Proxy"' };
    const config = yaml.load(generateMihomoYaml([], [renamedGroup, directGroup], [], [remoteSet])) as {
      'rule-providers': Record<string, { proxy: string }>;
    };
    expect(Object.values(config['rule-providers']).map((provider) => provider.proxy))
      .toEqual(['My "Proxy"', 'My "Proxy"']);
  });

  it.each([
    { name: 'no groups', groups: [] },
    { name: 'direct only', groups: [directGroup] },
    { name: 'reject default', groups: [{ ...proxyGroup, type: 'reject' as const }] },
  ])(
    'uses DIRECT for Mihomo downloads when there is no default proxy group: $name',
    ({ groups }) => {
      const config = yaml.load(generateMihomoYaml([], groups, [], [remoteSet])) as {
        'rule-providers': Record<string, { proxy: string }>;
      };
      expect(Object.values(config['rule-providers']).map((provider) => provider.proxy))
        .toEqual(['DIRECT', 'DIRECT']);
    }
  );

  it('does not add Mihomo download proxy fields to Stash rule providers', () => {
    const config = yaml.load(generateStashYaml([], [proxyGroup, directGroup], [matchRule], [remoteSet])) as {
      'rule-providers': Record<string, { proxy?: string }>;
    };
    expect(config['rule-providers'].Ads_List).not.toHaveProperty('proxy');
  });

  it('keeps manual overrides ordered before remote policies and fallback in every full-config client', () => {
    const first = { ...matchRule, id: 'first', type: 'DOMAIN' as const, payload: 'first.example', order: 10 };
    const second = { ...first, id: 'second', payload: 'second.example', order: 20 };
    const fallback = { ...matchRule, order: 0 };
    const rules = [fallback, second, first];
    const rows = rules.map(ruleRow);
    for (const render of [generateMihomoYaml, generateStashYaml]) {
      const config = yaml.load(render([], [proxyGroup, directGroup], rules, [quixoticPresetSet])) as { rules: string[] };
      const firstIndex = config.rules.findIndex(rule => rule.includes('first.example'));
      const secondIndex = config.rules.findIndex(rule => rule.includes('second.example'));
      const remoteIndex = config.rules.findIndex(rule => rule.startsWith('RULE-SET,AI,'));
      const finalIndex = config.rules.findIndex(rule => rule.startsWith('MATCH,'));
      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThan(firstIndex);
      expect(remoteIndex).toBeGreaterThan(secondIndex);
      expect(finalIndex).toBeGreaterThan(remoteIndex);
    }
    const singbox = JSON.parse(generateSingboxJson([], [proxyGroup, directGroup], rules, [quixoticPresetSet]));
    const sbRules = singbox.route.rules as Array<Record<string, unknown>>;
    expect(sbRules.findIndex(rule => (rule.domain as string[] | undefined)?.includes('first.example')))
      .toBeLessThan(sbRules.findIndex(rule => (rule.domain as string[] | undefined)?.includes('second.example')));
    expect(sbRules.at(-1)).toMatchObject({ rule_set: ['AI'] });
    expect(singbox.route.final).toBe('PROXY');

    const remoteRow = { ...quixoticPresetSet, enabled: 1, target_group_id: directGroup.id, preset_source: 'quixotic', preset_id: 'ai', sort_order: 5 };
    for (const render of [generateSurge, generateShadowrocket]) {
      const section = render([], groupRows, rows, [remoteRow]).split('[Rule]')[1]!.split('[Host]')[0]!;
      expect(section.indexOf('first.example')).toBeGreaterThanOrEqual(0);
      expect(section.indexOf('second.example')).toBeGreaterThan(section.indexOf('first.example'));
      expect(section.indexOf('RULE-SET,')).toBeGreaterThan(section.indexOf('second.example'));
      expect(section.trim().split('\n').at(-1)).toBe('FINAL,PROXY');
    }
    for (const [render, local, remote] of [
      [generateLoon, '[Rule]', '[Remote Rule]'],
      [generateQuantumultX, '[filter_local]', '[filter_remote]'],
    ] as const) {
      const config = render([], groupRows, rows, [remoteRow]);
      const section = config.split(local)[1]!.split('\n[')[0]!;
      expect(section.indexOf('first.example')).toBeGreaterThanOrEqual(0);
      expect(section.indexOf('second.example')).toBeGreaterThan(section.indexOf('first.example'));
      expect(section.trim().split('\n').at(-1)?.replaceAll(' ', '')).toBe('FINAL,PROXY');
      expect(config.split(remote)[1]!.split('\n[')[0]).toContain('/ai.list');
    }
    const egern = yaml.load(generateEgern([], groupRows, rows, [remoteRow])) as { rules: Array<Record<string, unknown>> };
    expect(egern.rules).toMatchObject([
      { domain: { match: 'first.example' } },
      { domain: { match: 'second.example' } },
      { rule_set: { policy: 'DIRECT' } },
      { default: { policy: 'PROXY' } },
    ]);
  });

  it('uses the published Quantumult X China IP file for both presets', () => {
    expect(resolveQuixoticRuleSetForExport('cncidr-resolve', 'quantumultx')).toEqual(
      resolveQuixoticRuleSetForExport('cncidr', 'quantumultx')
    );
    expect(resolveQuixoticRuleSetForExport('cncidr-resolve', 'quantumultx').url).toContain('/quantumultx/cncidr.list');
  });

  it('routes Mihomo remote rule sets before MATCH', () => {
    const content = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [remoteSet]);

    expect(content).toContain('Ads_List:');
    expect(content).toContain('behavior: classical');
    expect(content).toContain('format: yaml');
    expect(content).toContain('url: "https://example.com/ads.yaml"');
    expect(content).toContain('path: ./ruleset/Ads_List.yaml');
    expect(content).toContain('  - RULE-SET,Ads_List,DIRECT');
    expect(content.indexOf('  - RULE-SET,Ads_List,DIRECT')).toBeLessThan(
      content.indexOf('  - MATCH,PROXY')
    );
    expect(content).not.toContain('ai.srs');
  });

  it('rejects UDP only after an unsupported final Mihomo proxy', () => {
    const mihomo = generateMihomoYaml([], [proxyGroup], [matchRule], []);
    const stash = generateStashYaml([], [proxyGroup], [matchRule], []);

    expect(mihomo).not.toContain('DST-PORT,443)),REJECT');
    expect(mihomo).toContain('  - MATCH,PROXY\n  - NETWORK,UDP,REJECT');

    expect(stash).toContain('  - PROTOCOL,QUIC,REJECT');
    expect(stash).toContain('  - MATCH,PROXY');
    expect(stash).not.toContain('NETWORK,UDP,REJECT');
    expect(stash.indexOf('  - PROTOCOL,QUIC,REJECT')).toBeLessThan(
      stash.indexOf('  - MATCH,PROXY')
    );

    const directMatch = { ...matchRule, targetGroupId: directGroup.id };
    const direct = generateMihomoYaml([], [directGroup], [directMatch], []);
    expect(direct).toContain('  - MATCH,DIRECT');
    expect(direct).not.toContain('NETWORK,UDP,REJECT');

    const scopedProxyGroup = { ...proxyGroup, id: `workspace-1:${DEFAULT_RULE_TARGET_GROUP_ID}` };
    const implicitMatch = generateMihomoYaml([], [scopedProxyGroup], [], []);
    expect(implicitMatch).toContain('  - MATCH,PROXY\n  - NETWORK,UDP,REJECT');
  });

  it('emits native MRS metadata for Mihomo rule providers', () => {
    const content = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [{
      ...remoteSet,
      name: 'Private IP',
      url: 'https://example.com/private.mrs',
      format: 'mrs',
      behavior: 'ipcidr',
    }]);

    expect(content).toContain('    format: mrs');
    expect(content).toContain('    path: ./ruleset/Private_IP.mrs');
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
    expect(content).toContain('format: text');
    expect(content).toContain('url: "https://example.com/telegram.list"');
    expect(content).toContain('path: ./ruleset/Telegram_Domains.list');
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
      url: 'https://testingcf.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-google.srs',
      http_client: 'ruleSetHttp',
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

  it('keeps Stash target-native sources distinct from Mihomo sources', () => {
    const clientSpecificSet: RemoteRuleSet = {
      ...singboxRemoteSet,
      sourceOverrides: {
        mihomo: 'https://example.com/mihomo.yaml',
        stash: 'https://example.com/stash.yaml',
      },
    };

    const stash = generateStashYaml(
      [], [proxyGroup, directGroup], [matchRule], [clientSpecificSet]
    );
    const mihomo = generateMihomoYaml(
      [], [proxyGroup, directGroup], [matchRule], [clientSpecificSet]
    );

    expect(stash).toContain('https://example.com/stash.yaml');
    expect(stash).not.toContain('https://example.com/mihomo.yaml');
    expect(mihomo).toContain('https://example.com/mihomo.yaml');
    expect(stash).not.toContain('geox-url:');
    expect(mihomo).toContain('geox-url:');
  });

  it('preserves Stash identity in shared Mihomo-container conversion URLs', () => {
    const conversionBaseUrl = 'https://config.example.com/sub/public-token/rules';

    const stash = generateStashYaml(
      [], [proxyGroup, directGroup], [matchRule], [singboxRemoteSet], {},
      { ruleSetConversionBaseUrl: conversionBaseUrl }
    );

    expect(stash).toContain(`${conversionBaseUrl}/remote-singbox/mihomo.yaml?for=stash`);
  });

  it('reuses native China IP data and resolves only at the China IP Resolve policy', () => {
    const plain = { ...quixoticPresetSet, id: 'china-ip', presetId: 'cncidr', name: 'China IP', sortOrder: 1 };
    const resolving = { ...plain, id: 'china-ip-resolve', presetId: 'cncidr-resolve', name: 'China IP Resolve', sortOrder: 3 };
    const domainPolicy = { ...quixoticPresetSet, sortOrder: 2 };
    expect(resolveRuleSetConversionSource(resolving, 'singbox')).toBeNull();
    const config = JSON.parse(generateSingboxJson([], [proxyGroup, directGroup], [matchRule], [resolving, domainPolicy, plain]));
    for (const tag of ['China_IP', 'China_IP_Resolve']) {
      expect(config.route.rule_set).toContainEqual(expect.objectContaining({
        tag,
        format: 'binary',
        url: 'https://testingcf.jsdelivr.net/gh/QuixoticHeart/rule-set@ruleset/singbox/version5/cncidr.srs',
      }));
    }
    const rules = config.route.rules as Array<Record<string, unknown>>;
    const plainIndex = rules.findIndex(rule => (rule.rule_set as string[] | undefined)?.includes('China_IP'));
    const resolvingIndex = rules.findIndex(rule => (rule.rule_set as string[] | undefined)?.includes('China_IP_Resolve'));
    expect(rules.slice(0, plainIndex + 1).some(rule => rule.action === 'resolve')).toBe(false);
    expect(rules[resolvingIndex - 1]).toEqual({ action: 'resolve', server: 'localDns', strategy: 'ipv4_only' });
    expect(rules[plainIndex + 1]).toMatchObject({ rule_set: ['AI'] });
    expect(resolvingIndex).toBe(plainIndex + 3);

    const disabled = JSON.parse(generateSingboxJson([], [proxyGroup], [], [{ ...resolving, enabled: false }, plain]));
    expect(disabled.route.rules.some((rule: Record<string, unknown>) => rule.action === 'resolve')).toBe(false);
  });

  it('maps every bundled Quixotic preset to a catalogued native sing-box resource', () => {
    const catalog = bundledRuleSetCatalogSnapshot.catalogs.find(item => item.id === 'quixotic')!;
    for (const preset of catalog.items) {
      if (preset.id === 'cncidr-resolve') {
        expect(resolveQuixoticRuleSetForExport(preset.id, 'singbox')).toEqual({
          format: 'singbox',
          url: 'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/singbox/version5/cncidr.srs',
        });
        continue;
      }
      const nativeSource = preset.sources.find(source => source.format === 'singbox');
      expect(nativeSource, `${preset.id} needs a verified native source or an explicit mapping`).toBeDefined();
      const resolved = resolveQuixoticRuleSetForExport(preset.id, 'singbox');
      expect(resolved.format).toBe('singbox');
      expect(resolved.url.replace('/refs/heads/', '/')).toBe(nativeSource!.url);
    }
  });

  it('resolves Quixotic presets to the current export format', () => {
    const singbox = generateSingboxJson([], [proxyGroup, directGroup], [matchRule], [quixoticPresetSet]);
    const config = JSON.parse(singbox) as { route: { rule_set: Array<Record<string, unknown>> } };

    expect(config.route.rule_set).toContainEqual(
      expect.objectContaining({
        tag: 'AI',
        format: 'binary',
        url: 'https://testingcf.jsdelivr.net/gh/QuixoticHeart/rule-set@ruleset/singbox/version5/ai.srs',
      })
    );

    const surge = generateSurge([], groupRows, ruleRows, [
      { ...quixoticPresetSet, preset_source: 'quixotic', preset_id: 'ai', target_group_id: directGroup.id },
    ]);
    expect(surge).toContain('RULE-SET,https://testingcf.jsdelivr.net/gh/QuixoticHeart/rule-set@ruleset/surge/ai.list,DIRECT');

    const mihomo = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [quixoticPresetSet]);
    expect(mihomo).toContain('format: text');
    expect(mihomo).toContain('path: ./ruleset/AI.list');

    const stash = generateStashYaml([], [proxyGroup, directGroup], [matchRule], [quixoticPresetSet]);
    expect(stash).toContain('format: text');
    expect(stash).toContain('path: ./ruleset/AI.list');
  });

  it('uses each client native entity container and reference form', () => {
    const mihomo = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [remoteSet]);
    expect(mihomo).toContain('proxies: []');
    expect(mihomo).toContain('proxy-groups:');
    expect(mihomo).toContain('rule-providers:');
    expect(mihomo).toContain('rules:');
    expect(mihomo).toContain('RULE-SET,Ads_List,DIRECT');

    const singbox = JSON.parse(generateSingboxJson(
      [], [proxyGroup, directGroup], [matchRule], [singboxRemoteSet]
    )) as Record<string, unknown>;
    expect(singbox).toHaveProperty('outbounds');
    expect(singbox).toHaveProperty('route.rule_set');
    expect(singbox).toHaveProperty('route.rules');
    expect(singbox).toHaveProperty('dns.servers');

    const loon = generateLoon([], groupRows, ruleRows, [
      { ...remoteSet, format: 'loon', target_group_id: directGroup.id },
    ]);
    for (const section of [
      '[Proxy]',
      '[Remote Proxy]',
      '[Remote Filter]',
      '[Proxy Group]',
      '[Rule]',
      '[Remote Rule]',
      '[Host]',
      '[Rewrite]',
      '[Script]',
      '[Plugin]',
      '[Mitm]',
    ]) {
      expect(loon).toContain(section);
    }

    const surge = generateSurge([], groupRows, ruleRows, [
      { ...remoteSet, format: 'surge', target_group_id: directGroup.id },
    ]);
    expect(surge).toContain('[Proxy]');
    expect(surge).toContain('[Proxy Group]');
    expect(surge).toContain('[Rule]');
    expect(surge).not.toContain('[Remote Rule]');

    const shadowrocket = generateShadowrocket([], groupRows, ruleRows, [
      { ...remoteSet, format: 'shadowrocket', target_group_id: directGroup.id },
    ]);
    expect(shadowrocket).toContain('[Proxy]');
    expect(shadowrocket).toContain('[Proxy Group]');
    expect(shadowrocket).toContain('[Rule]');
    expect(shadowrocket).not.toContain('[Remote Rule]');

    const quantumultx = generateQuantumultX([], groupRows, ruleRows, [
      { ...remoteSet, format: 'quantumultx', target_group_id: directGroup.id },
    ]);
    for (const section of ['[policy]', '[server_remote]', '[filter_remote]', '[server_local]', '[filter_local]']) {
      expect(quantumultx).toContain(section);
    }

    const egern = yaml.load(generateEgern([], groupRows, ruleRows, [
      { ...remoteSet, format: 'egern', target_group_id: directGroup.id },
    ])) as Record<string, unknown>;
    expect(egern).toHaveProperty('proxies');
    expect(egern).toHaveProperty('policy_groups');
    expect(egern).toHaveProperty('rules');
    expect(egern).toHaveProperty('dns');
  });

  it('skips unsupported local rules for INI-style clients', () => {
    const surge = generateSurge([], groupRows, [ruleRow(geositeRule), ruleRow(scriptRule), ruleRow(matchRule)], []);
    const shadowrocket = generateShadowrocket([], groupRows, [ruleRow(geositeRule), ruleRow(scriptRule), ruleRow(matchRule)], []);

    expect(surge).not.toContain('GEOSITE,google,PROXY');
    expect(shadowrocket).not.toContain('GEOSITE,google,PROXY');
    expect(surge).not.toContain('SCRIPT');
    expect(shadowrocket).not.toContain('SCRIPT');
  });

  it('skips unsupported local rules for Quantumult X', () => {
    const quantumultx = generateQuantumultX([], groupRows, [ruleRow(scriptRule), ruleRow(matchRule)], []);

    expect(quantumultx).not.toContain('SCRIPT');
    expect(quantumultx).toContain('FINAL,PROXY');
  });

  it('skips unsupported local rules for Loon', () => {
    const loon = generateLoon([], groupRows, [ruleRow(geositeRule), ruleRow(processPathRule), ruleRow(matchRule)], []);

    expect(loon).not.toContain('GEOSITE, google, PROXY');
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

  it('routes Shadowrocket remote rule sets directly from the resolved URL', () => {
    const content = generateShadowrocket([], groupRows, ruleRows, [
      {
        ...quixoticPresetSet,
        preset_source: 'quixotic',
        preset_id: 'ai',
        target_group_id: directGroup.id,
      },
    ]);

    expect(content).not.toContain('[Remote Rule]');
    expect(content).toContain(
      'RULE-SET,https://testingcf.jsdelivr.net/gh/QuixoticHeart/rule-set@ruleset/shadowrocket/ai.list,DIRECT',
    );
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
    const config = yaml.load(content) as {
      auto_update: { url: string; interval: number }
      rules: Array<Record<string, unknown>>
    }
    expect(config.auto_update).toEqual({
      url: 'https://conf.example/sub/token/egern.yaml',
      interval: 86400,
    })
    expect(config.rules).toContainEqual({
      rule_set: {
        match: `${conversionBaseUrl}/${singboxRemoteSet.id}/egern.yaml`,
        policy: 'DIRECT',
        update_interval: 86400,
      },
    })
  });
});
