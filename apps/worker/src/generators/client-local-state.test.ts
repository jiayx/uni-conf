import { describe, expect, it } from 'vitest'
import { generateQuantumultX, generateSurge } from './client-configs'
import { generateLoon } from './loon'

const secretFields = ['ca-p12', 'ca-passphrase', 'passphrase =', 'p12 =']

describe('client-local state boundaries', () => {
  it('does not let a complete Loon export disable or replace local MITM state', () => {
    const content = generateLoon([], [], [], [])

    expect(content).not.toContain('[MITM]')
    expect(content).not.toContain('[URL Rewrite]')
    expect(content).not.toContain('enable = false')
    for (const field of secretFields) expect(content.toLowerCase()).not.toContain(field)
  })

  it('does not put MITM certificate material in a complete Surge export', () => {
    const content = generateSurge([], [], [], [])

    expect(content).not.toContain('[MITM]')
    for (const field of secretFields) expect(content.toLowerCase()).not.toContain(field)
  })

  it('emits every required Quantumult X section once, leaving MITM empty', () => {
    const content = generateQuantumultX([], [], [], [])
    const sections = [...content.matchAll(/^\[([^\]]+)]$/gm)].map((match) => match[1])
    const expectedOrder = [
      'general',
      'dns',
      'policy',
      'server_remote',
      'filter_remote',
      'rewrite_remote',
      'server_local',
      'filter_local',
      'rewrite_local',
      'task_local',
      'http_backend',
      'mitm',
    ]

    expect(sections).toEqual(expectedOrder)
    expect(content).toMatch(/\[mitm]\n\s*$/)
    for (const field of secretFields) expect(content.toLowerCase()).not.toContain(field)
  })
})
