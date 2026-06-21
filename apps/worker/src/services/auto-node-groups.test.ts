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
        markerText: '[uni-conf:auto-node-group] country:US:url-test',
        filters: [{ id: 'auto-country-us', field: 'countryCode', operator: 'equals', value: 'US', enabled: true }],
      },
      {
        key: 'country:HK:url-test',
        name: '🇭🇰 HK Auto',
        markerText: '[uni-conf:auto-node-group] country:HK:url-test',
        filters: [{ id: 'auto-country-hk', field: 'countryCode', operator: 'equals', value: 'HK', enabled: true }],
      },
      {
        key: 'tag:streaming:url-test',
        name: 'Streaming Auto',
        markerText: '[uni-conf:auto-node-group] tag:streaming:url-test',
        filters: [{ id: 'auto-tag-streaming', field: 'tag', operator: 'in', value: ['streaming', 'unlock'], enabled: true }],
      },
      {
        key: 'tag:native:url-test',
        name: 'Native Auto',
        markerText: '[uni-conf:auto-node-group] tag:native:url-test',
        filters: [{ id: 'auto-tag-native', field: 'tag', operator: 'in', value: ['residential', 'native-ip'], enabled: true }],
      },
    ]);
  });
});
