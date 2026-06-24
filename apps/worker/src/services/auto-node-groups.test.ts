import { describe, expect, it } from 'vitest';
import { buildAutoNodeGroupPlans } from './auto-node-groups';

describe('auto node groups', () => {
  it('builds country and tag-backed auto node group plans', () => {
    const plans = buildAutoNodeGroupPlans(
      [
        { countryCode: 'US', country: 'United States' },
        { countryCode: 'HK', country: 'Hong Kong' },
      ],
      ['streaming', 'native']
    );

    expect(plans).toEqual([
      {
        key: 'country:US:url-test',
        name: '🇺🇸 US Auto',
        type: 'url-test',
        markerText: '[uni-conf:auto-node-group] country:US:url-test',
        filters: [
          { id: 'auto-country-us', field: 'countryCode', operator: 'equals', value: 'US', enabled: true },
          { id: 'auto-exclude-high-multiplier', field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true },
        ],
      },
      {
        key: 'country:HK:url-test',
        name: '🇭🇰 HK Auto',
        type: 'url-test',
        markerText: '[uni-conf:auto-node-group] country:HK:url-test',
        filters: [
          { id: 'auto-country-hk', field: 'countryCode', operator: 'equals', value: 'HK', enabled: true },
          { id: 'auto-exclude-high-multiplier', field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true },
        ],
      },
      {
        key: 'tag:streaming:url-test',
        name: 'Streaming Auto',
        type: 'url-test',
        markerText: '[uni-conf:auto-node-group] tag:streaming:url-test',
        filters: [
          { id: 'auto-tag-streaming', field: 'tag', operator: 'in', value: ['streaming', 'unlock'], enabled: true },
          { id: 'auto-exclude-high-multiplier', field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true },
        ],
      },
      {
        key: 'tag:native:url-test',
        name: 'Native Auto',
        type: 'url-test',
        markerText: '[uni-conf:auto-node-group] tag:native:url-test',
        filters: [
          { id: 'auto-tag-native', field: 'tag', operator: 'in', value: ['residential', 'native-ip'], enabled: true },
          { id: 'auto-exclude-high-multiplier', field: 'tag', operator: 'not_in', value: ['high-multiplier'], enabled: true },
        ],
      },
    ]);
  });

  it('builds selected policy types without old marker formats', () => {
    const plans = buildAutoNodeGroupPlans(
      [{ countryCode: 'US', country: 'United States' }],
      [],
      ['select', 'fallback'],
      false
    );

    expect(plans.map((plan) => [plan.key, plan.name, plan.type, plan.markerText])).toEqual([
      ['country:US:select', 'US Select', 'select', '[uni-conf:auto-node-group] country:US:select'],
      ['country:US:fallback', 'US Fallback', 'fallback', '[uni-conf:auto-node-group] country:US:fallback'],
    ]);
  });
});
