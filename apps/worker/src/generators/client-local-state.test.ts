import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import {
  generateEgern,
  generateQuantumultX,
  generateShadowrocket,
  generateStashYaml,
  generateSurge,
} from './client-configs'
import { generateMihomoYaml } from './mihomo'
import { generateSingboxJson } from './singbox'
import { generateLoon } from './loon'

const secretFields = ['passphrase =', 'p12 =']

describe('client-local state boundaries', () => {
  it('declares an empty Loon Mitm section without exporting certificate material', () => {
    const content = generateLoon([], [], [], [])

    expect(content).toContain(
      '[Mitm]\nhostname=\nca-p12=\nca-passphrase=\nskip-server-cert-verify=false',
    )
    expect(content).toContain('[Rewrite]\n\n[Script]\n\n[Plugin]')
    expect(content).not.toContain('[URL Rewrite]')
    expect(content).not.toContain('enable = false')
    expect(content).not.toMatch(/^hostname=.+$/m)
    expect(content).not.toMatch(/^ca-p12=.+$/m)
    expect(content).not.toMatch(/^ca-passphrase=.+$/m)
    for (const field of secretFields) expect(content.toLowerCase()).not.toContain(field)
  })

  it('emits the complete native Loon section skeleton in order', () => {
    const content = generateLoon([], [], [], [])
    const sections = [...content.matchAll(/^\[([^\]]+)]$/gm)].map((match) => match[1])

    expect(sections).toEqual([
      'General',
      'Proxy',
      'Remote Proxy',
      'Remote Filter',
      'Proxy Group',
      'Rule',
      'Remote Rule',
      'Host',
      'Rewrite',
      'Script',
      'Plugin',
      'Mitm',
    ])
    expect(content).toContain('ipv6-vif = off')
    expect(content).toContain('sni-sniffing = true')
    expect(content).toContain('udp-fallback-mode = REJECT')
    expect(content).not.toContain('disable-stun = true')
    expect(content).not.toContain('resource-parser =')
  })

  it('exports Loon GeoIP resources and separate proxy/TUN bypass lists', () => {
    const content = generateLoon([], [], [], [])

    expect(content).toContain('geoip-url = https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/Country-without-asn.mmdb')
    expect(content).toContain('ipasn-url = https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/GeoLite2-ASN.mmdb')
    expect(content).toContain(
      'skip-proxy = localhost, *.local, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16',
    )
    expect(content).toContain(
      'bypass-tun = 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 255.255.255.255/32',
    )
    expect(content).not.toContain('e.crashlynatics.com')
  })

  it('emits the complete native Surge feature skeleton without certificate material', () => {
    const content = generateSurge([], [], [], [])
    const sections = [...content.matchAll(/^\[([^\]]+)]$/gm)].map((match) => match[1])

    expect(sections).toEqual([
      'General',
      'Proxy',
      'Proxy Group',
      'Rule',
      'Host',
      'URL Rewrite',
      'Header Rewrite',
      'Body Rewrite',
      'Map Local',
      'Script',
      'MITM',
    ])
    expect(content).toMatch(/\[MITM]\n\s*$/)
    for (const field of secretFields) expect(content.toLowerCase()).not.toContain(field)
  })

  it('emits the native Shadowrocket feature skeleton without certificate material', () => {
    const content = generateShadowrocket([], [], [], [])
    const sections = [...content.matchAll(/^\[([^\]]+)]$/gm)].map((match) => match[1])

    expect(sections).toEqual([
      'General',
      'Proxy',
      'Proxy Group',
      'Rule',
      'Host',
      'URL Rewrite',
      'Script',
      'MITM',
    ])
    expect(content).toMatch(/\[MITM]\n\s*$/)
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

  it('omits inactive feature containers from YAML and JSON clients', () => {
    const mihomo = yaml.load(generateMihomoYaml([], [], [], [])) as Record<string, unknown>
    const stash = yaml.load(generateStashYaml([], [], [], [])) as Record<string, unknown>
    const egern = yaml.load(generateEgern([], [], [], [])) as Record<string, unknown>
    const singBox = JSON.parse(generateSingboxJson([], [], [], [])) as Record<string, unknown>

    expect(mihomo).not.toHaveProperty('listeners')
    expect(mihomo).not.toHaveProperty('proxy-providers')
    expect(stash).not.toHaveProperty('http')
    expect(stash).not.toHaveProperty('cron')
    expect(stash).not.toHaveProperty('script-providers')
    expect(egern).not.toHaveProperty('url_rewrites')
    expect(egern).not.toHaveProperty('scriptings')
    expect(egern).not.toHaveProperty('mitm')
    expect(egern).not.toHaveProperty('modules')
    expect(singBox).not.toHaveProperty('certificate')
    expect(singBox).not.toHaveProperty('certificate_providers')
    expect(singBox).not.toHaveProperty('services')
  })
})
