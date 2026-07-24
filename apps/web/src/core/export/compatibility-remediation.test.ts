import { describe, expect, it } from 'vitest'
import { compatibilityRemediationAction } from './compatibility-remediation'

describe('compatibilityRemediationAction', () => {
  it('builds an encoded entity editor URL from structured remediation', () => {
    expect(compatibilityRemediationAction({
      client: 'mihomo', level: 'unsupported', message: 'x', messageEn: 'x',
      remediation: { target: 'remote-rule-sets', id: 'set/a b' },
    })).toEqual({
      to: '/remote-rule-sets?edit=set%2Fa%20b',
      labelKey: 'preview.fix_remote_rule_sets',
    })
  })

  it('links a rule-set conversion problem to the exact native-source field', () => {
    expect(compatibilityRemediationAction({
      client: 'singbox', level: 'unsupported', message: 'x', messageEn: 'x',
      remediation: {
        target: 'remote-rule-sets',
        id: 'set/a b',
        sourceOverrideTarget: 'singbox',
      },
    })).toEqual({
      to: '/remote-rule-sets?edit=set%2Fa%20b&nativeSource=singbox',
      labelKey: 'preview.fix_remote_rule_sets',
    })
  })

  it('links settings remediation to the exact section', () => {
    expect(compatibilityRemediationAction({
      client: 'surge', level: 'partial', message: 'x', messageEn: 'x',
      remediation: { target: 'settings', section: 'dns' },
    })).toEqual({ to: '/settings#dns', labelKey: 'preview.fix_settings' })
  })

  it('does not infer actions from warning text', () => {
    expect(compatibilityRemediationAction({
      client: 'mihomo', level: 'unsupported', message: '节点错误', messageEn: 'Node error',
    })).toBeNull()
  })
})
