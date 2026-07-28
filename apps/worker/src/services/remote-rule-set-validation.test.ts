import { describe, expect, it, vi } from 'vitest'
import { convertRuleSetContent } from '@uni-conf/rule-set'
import { validateRemoteRuleSetContent } from './remote-rule-set-validation'

describe('remote rule set content validation', () => {
  it('validates a plain domain list and ignores comments', async () => {
    const result = await validateRemoteRuleSetContent(ruleSet({ behavior: 'domain' }), {
      checkedAt: '2026-07-14T00:00:00.000Z',
      fetcher: responseFetcher('# comment\nexample.com\n+.openai.com\n'),
    })

    expect(result).toMatchObject({
      status: 'valid',
      inspectionMode: 'text',
      ruleCount: 2,
      invalidRuleCount: 0,
      checkedAt: '2026-07-14T00:00:00.000Z',
    })
  })

  it('parses YAML payloads and reports behavior mismatches', async () => {
    const result = await validateRemoteRuleSetContent(ruleSet({ format: 'mihomo', behavior: 'classical' }), {
      fetcher: responseFetcher('payload:\n  - DOMAIN-SUFFIX,example.com\n  - not-a-classical-rule\n', 'text/yaml'),
    })

    expect(result).toMatchObject({
      status: 'warning',
      inspectionMode: 'structured',
      ruleCount: 2,
      invalidRuleCount: 1,
    })
    expect(result.issues[0]).toMatchObject({ code: 'invalid_rule', line: 2, severity: 'warning' })
  })

  it('accepts sing-box source JSON rule objects', async () => {
    const result = await validateRemoteRuleSetContent(ruleSet({ format: 'singbox', behavior: 'domain' }), {
      fetcher: responseFetcher(JSON.stringify({ version: 3, rules: [{ domain_suffix: ['example.com'] }] }), 'application/json'),
    })

    expect(result).toMatchObject({ status: 'valid', inspectionMode: 'structured', ruleCount: 1 })
  })

  it('auto-detects structured content when the source format is generic text', async () => {
    const result = await validateRemoteRuleSetContent(ruleSet({ format: 'text', behavior: 'domain' }), {
      fetcher: responseFetcher(JSON.stringify({
        version: 3,
        rules: [{ domain_suffix: ['example.com'] }],
      }), 'application/json'),
    })

    expect(result).toMatchObject({ status: 'valid', inspectionMode: 'structured', ruleCount: 1 })
  })

  it('validates and counts all native Egern rule-set arrays', async () => {
    const result = await validateRemoteRuleSetContent(ruleSet({ format: 'egern', behavior: 'classical' }), {
      fetcher: responseFetcher([
        'domain_set:', '  - exact.example',
        'domain_suffix_set:', '  - suffix.example',
        'ip_cidr_set:', '  - 10.0.0.0/8',
        'dest_port_set:', '  - 443',
        'protocol_set:', '  - quic',
      ].join('\n'), 'text/yaml'),
    })

    expect(result).toMatchObject({
      status: 'valid', inspectionMode: 'structured', ruleCount: 5, invalidRuleCount: 0,
    })
  })

  it('reports Egern behavior mismatches and malformed native values precisely', async () => {
    const mismatch = await validateRemoteRuleSetContent(ruleSet({ format: 'egern', behavior: 'domain' }), {
      fetcher: responseFetcher('domain_set:\n  - valid.example\nip_cidr_set:\n  - 10.0.0.0/8\n', 'text/yaml'),
    })
    expect(mismatch).toMatchObject({ status: 'warning', ruleCount: 2, invalidRuleCount: 1 })

    const malformed = await validateRemoteRuleSetContent(ruleSet({ format: 'egern', behavior: 'classical' }), {
      fetcher: responseFetcher('domain_regex_set:\n  - "[invalid"\ndest_port_set:\n  - 70000\n', 'text/yaml'),
    })
    expect(malformed).toMatchObject({ status: 'warning', ruleCount: 2, invalidRuleCount: 2 })
  })

  it('rejects Egern YAML without native rule-set arrays', async () => {
    const result = await validateRemoteRuleSetContent(ruleSet({ format: 'egern', behavior: 'classical' }), {
      fetcher: responseFetcher('payload:\n  - DOMAIN,example.com\n', 'text/yaml'),
    })
    expect(result).toMatchObject({ status: 'invalid', issues: [{ code: 'invalid_structure' }] })
  })

  it('keeps native Egern validation and cross-client conversion diagnostics consistent', async () => {
    const content = [
      'domain_set:', '  - exact.example',
      'ip_cidr_set:', '  - 10.0.0.0/8',
      'user_agent_set:', '  - ExampleApp*',
    ].join('\n')
    const validation = await validateRemoteRuleSetContent(ruleSet({ format: 'egern', behavior: 'classical' }), {
      fetcher: responseFetcher(content, 'text/yaml'),
    })
    const conversion = convertRuleSetContent(
      { format: 'egern', behavior: 'classical' },
      'singbox',
      content
    )

    expect(validation).toMatchObject({ status: 'valid', ruleCount: 3, invalidRuleCount: 0 })
    expect(conversion).toMatchObject({
      convertedRuleCount: 2,
      skippedRuleCount: 1,
      skippedRuleTypes: { 'USER-AGENT': 1 },
    })
  })

  it('rejects a corrupt SRS binary container after inspecting its contents', async () => {
    const result = await validateRemoteRuleSetContent(ruleSet({ format: 'singbox' }), {
      fetcher: responseFetcher(new Uint8Array([0x53, 0x52, 0x53, 0x01, 0x00]), 'application/octet-stream'),
    })

    expect(result).toMatchObject({
      status: 'invalid',
      inspectionMode: 'structured',
      issues: [{ code: 'invalid_srs', severity: 'error' }],
    })
  })

  it('rejects HTML error pages returned with a successful status', async () => {
    const result = await validateRemoteRuleSetContent(ruleSet(), {
      fetcher: responseFetcher('<!doctype html><title>Login</title>', 'text/html'),
    })

    expect(result).toMatchObject({ status: 'invalid', issues: [{ code: 'html_response' }] })
  })

  it('enforces the response size limit before parsing content', async () => {
    const result = await validateRemoteRuleSetContent(ruleSet(), {
      maxBytes: 4,
      fetcher: responseFetcher('example.com'),
    })

    expect(result).toMatchObject({ status: 'invalid', issues: [{ code: 'content_too_large' }] })
  })

  it('returns actionable results for network and HTTP failures', async () => {
    const failed = await validateRemoteRuleSetContent(ruleSet(), {
      fetcher: vi.fn(async () => { throw new Error('network') }) as unknown as typeof fetch,
    })
    const forbidden = await validateRemoteRuleSetContent(ruleSet(), {
      fetcher: responseFetcher('Forbidden', 'text/plain', 403),
    })

    expect(failed).toMatchObject({ status: 'invalid', issues: [{ code: 'download_failed' }] })
    expect(forbidden).toMatchObject({ status: 'invalid', httpStatus: 403, issues: [{ code: 'http_error' }] })
  })

  it('rejects private targets and private redirect destinations without fetching them', async () => {
    const privateFetcher = vi.fn(async () => new Response('should not run')) as unknown as typeof fetch
    const privateResult = await validateRemoteRuleSetContent(ruleSet({ url: 'http://169.254.169.254/latest/meta-data' }), {
      fetcher: privateFetcher,
    })
    expect(privateResult).toMatchObject({ status: 'invalid', issues: [{ code: 'unsafe_url' }] })
    expect(privateFetcher).not.toHaveBeenCalled()

    const redirectFetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    })) as unknown as typeof fetch
    const redirectResult = await validateRemoteRuleSetContent(ruleSet(), { fetcher: redirectFetcher })
    expect(redirectResult).toMatchObject({ status: 'invalid', issues: [{ code: 'unsafe_url' }] })
    expect(redirectFetcher).toHaveBeenCalledTimes(1)
  })
})

function ruleSet(patch: Partial<{ url: string; format: 'text' | 'mihomo' | 'singbox' | 'egern'; behavior: 'domain' | 'ipcidr' | 'classical' }> = {}) {
  return {
    url: 'https://example.com/rules.list',
    format: 'text' as const,
    behavior: 'domain' as const,
    ...patch,
  }
}

function responseFetcher(
  body: BodyInit,
  contentType = 'text/plain',
  status = 200
): typeof fetch {
  return vi.fn(async () => new Response(body, {
    status,
    headers: { 'content-type': contentType },
  })) as unknown as typeof fetch
}
