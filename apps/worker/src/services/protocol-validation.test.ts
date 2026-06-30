import { describe, expect, it } from 'vitest';
import { isUsableProxyProtocol, missingRequiredProtocolFields } from './protocol-validation';

describe('protocol validation', () => {
  it('accepts mainstream proxy protocols and rejects pseudo protocols', () => {
    expect(isUsableProxyProtocol('trojan')).toBe(true);
    expect(isUsableProxyProtocol('anytls')).toBe(true);
    expect(isUsableProxyProtocol('direct')).toBe(false);
    expect(isUsableProxyProtocol('reject')).toBe(false);
    expect(isUsableProxyProtocol('unknown')).toBe(false);
  });

  it('finds missing required fields across normalized, extra, and native config shapes', () => {
    expect(missingRequiredProtocolFields('trojan', { protocol: 'trojan', extra: {} }, {})).toEqual(['password']);
    expect(missingRequiredProtocolFields('trojan', { protocol: 'trojan', password: 'pwd', extra: {} }, {})).toEqual([]);
    expect(missingRequiredProtocolFields('trojan', { protocol: 'trojan', extra: { password: 'pwd' } }, {})).toEqual([]);
    expect(missingRequiredProtocolFields('trojan', { protocol: 'trojan', extra: {} }, { password: 'pwd' })).toEqual([]);
    expect(missingRequiredProtocolFields('wireguard', { protocol: 'wireguard', extra: {} }, {
      'private-key': 'private',
      'public-key': 'public',
    })).toEqual([]);
  });
});
