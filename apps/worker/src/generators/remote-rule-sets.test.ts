import { describe, expect, it } from 'vitest';
import type { ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types';
import { generateMihomoYaml } from './mihomo';
import { generateSingboxJson } from './singbox';

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

const remoteSet: RemoteRuleSet = {
  id: 'remote-ads',
  name: 'Ads List',
  url: 'https://example.com/ads.yaml',
  format: 'mihomo',
  targetGroupId: directGroup.id,
  updateInterval: 12,
  enabled: true,
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

describe('remote rule set generators', () => {
  it('routes Mihomo remote rule sets before MATCH', () => {
    const content = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [remoteSet]);

    expect(content).toContain('Ads_List:');
    expect(content).toContain('url: "https://example.com/ads.yaml"');
    expect(content).toContain('  - RULE-SET,Ads_List,DIRECT-GROUP');
    expect(content.indexOf('  - RULE-SET,Ads_List,DIRECT-GROUP')).toBeLessThan(
      content.indexOf('  - MATCH,PROXY')
    );
    expect(content).not.toContain('ai.srs');
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
      outbound: 'DIRECT-GROUP',
    });
    expect(config.route.final).toBe('PROXY');
  });

  it('skips incompatible remote rule set formats per exporter', () => {
    const mihomo = generateMihomoYaml([], [proxyGroup, directGroup], [matchRule], [singboxRemoteSet]);
    expect(mihomo).not.toContain('ai.srs');

    const singbox = generateSingboxJson([], [proxyGroup, directGroup], [matchRule], [remoteSet]);
    const config = JSON.parse(singbox) as { route: { rule_set: Array<Record<string, unknown>> } };
    expect(config.route.rule_set.some(item => item['url'] === remoteSet.url)).toBe(false);
  });
});
