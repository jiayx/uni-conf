import { load as parseYaml } from 'js-yaml'
import type {
  CompatibilityWarning,
  ExportArtifactValidationIssue,
  ExportArtifactValidationResult,
  ExportFormat,
} from '@uni-conf/types'

type RecordValue = Record<string, unknown>

export function validateRenderedExport(
  format: ExportFormat,
  content: string
): ExportArtifactValidationResult {
  if (format === 'mihomo' || format === 'stash') {
    return validateYamlProxyConfig(format, content)
  }
  if (format === 'egern') return validateEgernConfig(content)
  if (format === 'singbox') return validateSingBoxConfig(content)
  if (format === 'nodes_raw' || format === 'nodes_base64') {
    return validateNodeSubscription(format, content)
  }
  return validateIniConfig(format, content)
}

export function exportArtifactWarnings(
  validation: ExportArtifactValidationResult
): CompatibilityWarning[] {
  return validation.issues.map(item => ({
    client: validation.format,
    level: 'unsupported',
    message: `导出结果结构校验失败：${item.message}`,
    messageEn: `Export artifact validation failed: ${item.messageEn}`,
  }))
}

function validateYamlProxyConfig(format: ExportFormat, content: string): ExportArtifactValidationResult {
  const parsed = parseStructuredDocument(format, 'yaml', content, value => parseYaml(value))
  if (!parsed.value) return parsed.result
  const config = parsed.value
  const issues = [
    ...requireNonEmptyArray(config, 'proxies'),
    ...requireNonEmptyArray(config, 'proxy-groups'),
    ...requireNonEmptyArray(config, 'rules'),
  ]
  if (issues.length === 0) issues.push(...validateMihomoReferences(config))
  return result(format, 'yaml', issues)
}

function validateEgernConfig(content: string): ExportArtifactValidationResult {
  const parsed = parseStructuredDocument('egern', 'yaml', content, value => parseYaml(value))
  if (!parsed.value) return parsed.result
  const config = parsed.value
  const issues = [
    ...requireNonEmptyArray(config, 'proxies'),
    ...requireNonEmptyArray(config, 'policy_groups'),
    ...requireNonEmptyArray(config, 'rules'),
  ]
  if (issues.length === 0) issues.push(...validateEgernReferences(config))
  return result('egern', 'yaml', issues)
}

function validateSingBoxConfig(content: string): ExportArtifactValidationResult {
  const parsed = parseStructuredDocument('singbox', 'json', content, value => JSON.parse(value))
  if (!parsed.value) return parsed.result
  const config = parsed.value
  const issues = requireNonEmptyArray(config, 'outbounds')
  const route = asRecord(config['route'])
  if (!route) {
    issues.push(issue('missing_section', 'route', '缺少 route 对象', 'Missing the route object.'))
  } else {
    issues.push(...requireNonEmptyArray(route, 'rules', 'route.rules'))
  }
  if (issues.length === 0) issues.push(...validateSingBoxReferences(config, route!))
  return result('singbox', 'json', issues)
}

function validateIniConfig(format: ExportFormat, content: string): ExportArtifactValidationResult {
  const sections = parseIniSections(content)
  const required = format === 'quantumultx'
    ? ['general', 'server_local', 'policy', 'filter_local']
    : ['general', 'proxy', 'proxy group', 'rule']
  const issues: ExportArtifactValidationIssue[] = []
  for (const name of required) {
    const values = sections.get(name)
    if (!values) {
      issues.push(issue('missing_section', name, `缺少 [${name}] 段`, `Missing the [${name}] section.`))
    } else if (name !== 'general' && values.length === 0) {
      issues.push(issue('empty_section', name, `[${name}] 段为空`, `The [${name}] section is empty.`))
    }
  }
  if (issues.length === 0) {
    issues.push(...format === 'quantumultx'
      ? validateQuantumultXReferences(sections)
      : validateTextClientReferences(format, sections))
  }
  return result(format, 'ini', issues)
}

function validateNodeSubscription(format: ExportFormat, content: string): ExportArtifactValidationResult {
  let raw = content.trim()
  if (format === 'nodes_base64') {
    try {
      if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) throw new Error('invalid base64')
      raw = decodeBase64Utf8(raw)
    } catch {
      return result(format, 'subscription', [issue('invalid_base64', undefined, '节点订阅不是有效的 Base64', 'The node subscription is not valid Base64.')])
    }
  }
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const issues: ExportArtifactValidationIssue[] = []
  if (lines.length === 0) {
    issues.push(issue('empty_subscription', undefined, '节点订阅为空', 'The node subscription is empty.'))
  }
  for (const [index, line] of lines.entries()) {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) {
      issues.push(issue('invalid_uri', `line:${index + 1}`, `第 ${index + 1} 行不是有效的节点 URI`, `Line ${index + 1} is not a valid node URI.`))
    }
  }
  return result(format, 'subscription', issues)
}

function validateMihomoReferences(config: RecordValue): ExportArtifactValidationIssue[] {
  const proxies = config['proxies'] as unknown[]
  const groups = config['proxy-groups'] as unknown[]
  const rules = config['rules'] as unknown[]
  const proxyNames = new Set(proxies.map(item => asRecord(item)?.['name']).filter((name): name is string => typeof name === 'string'))
  const groupNames = new Set(groups.map(item => asRecord(item)?.['name']).filter((name): name is string => typeof name === 'string'))
  const targets = new Set([...proxyNames, ...groupNames, 'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS'])
  const issues: ExportArtifactValidationIssue[] = []
  const providers = asRecord(config['rule-providers']) ?? {}

  for (const [index, value] of groups.entries()) {
    const group = asRecord(value)
    if (!group) continue
    const members = group['proxies']
    if (!Array.isArray(members) || members.length === 0) continue
    for (const member of members) {
      if (typeof member === 'string' && targets.has(member)) continue
      issues.push(issue('missing_reference', `proxy-groups[${index}].proxies`, `策略组引用了不存在的成员 ${String(member)}`, `A proxy group references the missing member ${String(member)}.`))
    }
  }

  for (const [index, value] of rules.entries()) {
    if (typeof value !== 'string') continue
    const parts = value.split(',').map(item => item.trim())
    if (parts[0] === 'RULE-SET') {
      const provider = parts[1]
      if (!provider || !(provider in providers)) {
        issues.push(issue('missing_reference', `rules[${index}]`, `规则引用了不存在的规则提供器 ${String(provider)}`, `A rule references the missing rule provider ${String(provider)}.`))
      }
    }
    const target = parts.at(-1) === 'no-resolve' ? parts.at(-2) : parts.at(-1)
    if (target && targets.has(target)) continue
    issues.push(issue('missing_reference', `rules[${index}]`, `规则引用了不存在的策略 ${String(target)}`, `A rule references the missing policy ${String(target)}.`))
  }
  for (const [name, value] of Object.entries(providers)) {
    const provider = asRecord(value)
    if (!provider) {
      issues.push(issue('invalid_entry', `rule-providers.${name}`, `规则提供器 ${name} 必须是对象`, `Rule provider ${name} must be an object.`))
      continue
    }
    if (provider['type'] === 'http' && (typeof provider['url'] !== 'string' || !isHttpUrl(provider['url']))) {
      issues.push(issue('invalid_url', `rule-providers.${name}.url`, `规则提供器 ${name} 缺少有效的 http(s) URL`, `Rule provider ${name} is missing a valid HTTP(S) URL.`))
    }
  }
  return issues
}

function validateSingBoxReferences(config: RecordValue, route: RecordValue): ExportArtifactValidationIssue[] {
  const outbounds = config['outbounds'] as unknown[]
  const endpointsValue = config['endpoints']
  const endpoints = Array.isArray(endpointsValue) ? endpointsValue : []
  const tags = new Set<string>()
  const issues: ExportArtifactValidationIssue[] = []
  if (endpointsValue !== undefined && !Array.isArray(endpointsValue)) {
    issues.push(issue('invalid_entry', 'endpoints', 'sing-box endpoints 必须是数组', 'sing-box endpoints must be an array.'))
  }
  for (const [index, value] of outbounds.entries()) {
    const outbound = asRecord(value)
    const tag = outbound?.['tag']
    if (typeof tag !== 'string' || !tag) {
      issues.push(issue('missing_tag', `outbounds[${index}].tag`, '出站缺少 tag', 'An outbound is missing its tag.'))
    } else if (tags.has(tag)) {
      issues.push(issue('duplicate_tag', `outbounds[${index}].tag`, `出站 tag ${tag} 重复`, `Outbound tag ${tag} is duplicated.`))
    } else {
      tags.add(tag)
    }
  }
  for (const [index, value] of endpoints.entries()) {
    const endpoint = asRecord(value)
    const path = `endpoints[${index}]`
    const tag = endpoint?.['tag']
    if (typeof tag !== 'string' || !tag) {
      issues.push(issue('missing_tag', `${path}.tag`, '端点缺少 tag', 'An endpoint is missing its tag.'))
    } else if (tags.has(tag)) {
      issues.push(issue('duplicate_tag', `${path}.tag`, `端点 tag ${tag} 重复`, `Endpoint tag ${tag} is duplicated.`))
    } else {
      tags.add(tag)
    }
    if (endpoint?.['type'] === 'wireguard') {
      issues.push(...validateSingboxWireGuardEndpoint(endpoint, path))
    } else {
      issues.push(issue('invalid_entry', `${path}.type`, '不支持的 sing-box endpoint 类型', 'Unsupported sing-box endpoint type.'))
    }
  }
  for (const [index, value] of outbounds.entries()) {
    const outbound = asRecord(value)
    if (!outbound || !['selector', 'urltest'].includes(String(outbound['type'] ?? ''))) continue
    const references = outbound['outbounds']
    const path = `outbounds[${index}].outbounds`
    if (!Array.isArray(references) || references.length === 0) {
      issues.push(issue('empty_section', path, 'sing-box 策略组必须至少引用一个出站或端点', 'A sing-box outbound group must reference at least one outbound or endpoint.'))
      continue
    }
    for (const [referenceIndex, reference] of references.entries()) {
      if (typeof reference === 'string' && tags.has(reference)) continue
      issues.push(issue(
        'missing_reference',
        `${path}[${referenceIndex}]`,
        `策略组引用了不存在的出站或端点 ${String(reference)}`,
        `An outbound group references the missing outbound or endpoint ${String(reference)}.`
      ))
    }
  }
  const final = route['final']
  if (typeof final === 'string' && !tags.has(final)) {
    issues.push(issue('missing_reference', 'route.final', `route.final 引用了不存在的出站 ${final}`, `route.final references the missing outbound ${final}.`))
  }
  const rules = route['rules'] as unknown[]
  const ruleSetTags = new Set<string>()
  const ruleSets = route['rule_set']
  if (ruleSets !== undefined && !Array.isArray(ruleSets)) {
    issues.push(issue('missing_section', 'route.rule_set', 'route.rule_set 必须是数组', 'route.rule_set must be an array.'))
  }
  for (const [index, value] of (Array.isArray(ruleSets) ? ruleSets : []).entries()) {
    const ruleSet = asRecord(value)
    const tag = ruleSet?.['tag']
    if (typeof tag !== 'string' || !tag) {
      issues.push(issue('missing_tag', `route.rule_set[${index}].tag`, '规则集缺少 tag', 'A rule set is missing its tag.'))
      continue
    }
    if (ruleSetTags.has(tag)) {
      issues.push(issue('duplicate_tag', `route.rule_set[${index}].tag`, `规则集 tag ${tag} 重复`, `Rule-set tag ${tag} is duplicated.`))
    }
    ruleSetTags.add(tag)
    if (ruleSet?.['type'] === 'remote' && (typeof ruleSet['url'] !== 'string' || !isHttpUrl(ruleSet['url']))) {
      issues.push(issue('invalid_url', `route.rule_set[${index}].url`, `远程规则集 ${tag} 缺少有效的 http(s) URL`, `Remote rule set ${tag} is missing a valid HTTP(S) URL.`))
    }
  }
  for (const [index, value] of rules.entries()) {
    const rule = asRecord(value)
    const outbound = rule?.['outbound']
    if (outbound === undefined || (typeof outbound === 'string' && tags.has(outbound))) continue
    issues.push(issue('missing_reference', `route.rules[${index}].outbound`, `路由规则引用了不存在的出站 ${String(outbound)}`, `A route rule references the missing outbound ${String(outbound)}.`))
  }
  for (const [index, value] of rules.entries()) {
    const references = asRecord(value)?.['rule_set']
    if (references === undefined) continue
    const values = Array.isArray(references) ? references : [references]
    for (const reference of values) {
      if (typeof reference === 'string' && ruleSetTags.has(reference)) continue
      issues.push(issue('missing_reference', `route.rules[${index}].rule_set`, `路由规则引用了不存在的规则集 ${String(reference)}`, `A route rule references the missing rule set ${String(reference)}.`))
    }
  }
  return issues
}

function validateSingboxWireGuardEndpoint(
  endpoint: RecordValue,
  path: string
): ExportArtifactValidationIssue[] {
  const issues: ExportArtifactValidationIssue[] = []
  const addresses = endpoint['address']
  if (
    !(typeof addresses === 'string' && addresses)
    && !(Array.isArray(addresses) && addresses.length > 0 && addresses.every(item => typeof item === 'string' && item))
  ) {
    issues.push(issue('missing_field', `${path}.address`, 'WireGuard endpoint 缺少本地地址', 'A WireGuard endpoint is missing its local address.'))
  }
  if (typeof endpoint['private_key'] !== 'string' || !endpoint['private_key']) {
    issues.push(issue('missing_field', `${path}.private_key`, 'WireGuard endpoint 缺少 private_key', 'A WireGuard endpoint is missing private_key.'))
  }
  const peers = endpoint['peers']
  if (!Array.isArray(peers) || peers.length === 0) {
    issues.push(issue('empty_section', `${path}.peers`, 'WireGuard endpoint 缺少 peer', 'A WireGuard endpoint is missing its peer.'))
    return issues
  }
  for (const [index, value] of peers.entries()) {
    const peer = asRecord(value)
    const peerPath = `${path}.peers[${index}]`
    if (!peer) {
      issues.push(issue('invalid_entry', peerPath, 'WireGuard peer 必须是对象', 'A WireGuard peer must be an object.'))
      continue
    }
    if (typeof peer['address'] !== 'string' || !peer['address']) {
      issues.push(issue('missing_field', `${peerPath}.address`, 'WireGuard peer 缺少 address', 'A WireGuard peer is missing address.'))
    }
    const port = Number(peer['port'])
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      issues.push(issue('invalid_value', `${peerPath}.port`, 'WireGuard peer 端口无效', 'A WireGuard peer port is invalid.'))
    }
    if (typeof peer['public_key'] !== 'string' || !peer['public_key']) {
      issues.push(issue('missing_field', `${peerPath}.public_key`, 'WireGuard peer 缺少 public_key', 'A WireGuard peer is missing public_key.'))
    }
    const allowedIps = peer['allowed_ips']
    if (
      !(typeof allowedIps === 'string' && allowedIps)
      && !(Array.isArray(allowedIps) && allowedIps.length > 0 && allowedIps.every(item => typeof item === 'string' && item))
    ) {
      issues.push(issue('missing_field', `${peerPath}.allowed_ips`, 'WireGuard peer 缺少 allowed_ips', 'A WireGuard peer is missing allowed_ips.'))
    }
  }
  return issues
}

const EGERN_PROXY_TYPES = new Set([
  'shadowsocks', 'trojan', 'anytls', 'hysteria2', 'tuic',
  'socks5', 'socks5_tls', 'ssh', 'http', 'https',
  'vmess', 'vless', 'wireguard', 'snell',
])

const EGERN_POLICY_GROUP_TYPES = new Set([
  'select', 'auto_test', 'smart', 'fallback', 'load_balance',
])

const EGERN_RULE_TYPES = new Set([
  'domain', 'domain_suffix', 'domain_keyword', 'domain_regex',
  'geoip', 'ip_cidr', 'ip_cidr6', 'asn', 'dest_port', 'protocol',
  'rule_set', 'default',
])

function validateEgernReferences(config: RecordValue): ExportArtifactValidationIssue[] {
  const proxies = config['proxies'] as unknown[]
  const groups = config['policy_groups'] as unknown[]
  const rules = config['rules'] as unknown[]
  const issues: ExportArtifactValidationIssue[] = []
  const proxyNames = new Set<string>()
  const groupNames = new Set<string>()

  for (const [index, value] of proxies.entries()) {
    const entry = unwrapEgernEntry(value, `proxies[${index}]`, EGERN_PROXY_TYPES, '节点', 'proxy', issues)
    if (!entry) continue
    const path = `proxies[${index}].${entry.type}`
    collectEgernName(entry.body, `${path}.name`, proxyNames, '节点', 'proxy', issues)
    validateEgernProxyBody(entry.type, entry.body, path, issues)
  }

  for (const [index, value] of groups.entries()) {
    const entry = unwrapEgernEntry(value, `policy_groups[${index}]`, EGERN_POLICY_GROUP_TYPES, '策略组', 'policy group', issues)
    if (!entry) continue
    collectEgernName(
      entry.body,
      `policy_groups[${index}].${entry.type}.name`,
      groupNames,
      '策略组',
      'policy group',
      issues
    )
  }

  const targets = new Set([...proxyNames, ...groupNames, 'DIRECT', 'REJECT'])
  for (const [index, value] of groups.entries()) {
    const entry = unwrapEgernEntry(value, `policy_groups[${index}]`, EGERN_POLICY_GROUP_TYPES, '策略组', 'policy group', [])
    if (!entry) continue
    const path = `policy_groups[${index}].${entry.type}.policies`
    const policies = entry.body['policies']
    if (!Array.isArray(policies) || policies.length === 0) {
      issues.push(issue('empty_section', path, '策略组的 policies 不能为空', 'A policy group must contain at least one policy.'))
      continue
    }
    for (const [policyIndex, policy] of policies.entries()) {
      if (typeof policy === 'string' && targets.has(policy)) continue
      issues.push(issue(
        'missing_reference',
        `${path}[${policyIndex}]`,
        `策略组引用了不存在的策略 ${String(policy)}`,
        `A policy group references the missing policy ${String(policy)}.`
      ))
    }
  }

  for (const [index, value] of rules.entries()) {
    const entry = unwrapEgernEntry(value, `rules[${index}]`, EGERN_RULE_TYPES, '规则', 'rule', issues)
    if (!entry) continue
    if (entry.type === 'rule_set') {
      issues.push(...validateEgernRemoteRule(entry.body, index, targets))
      continue
    }
    const path = `rules[${index}].${entry.type}`
    if (entry.type !== 'default' && (typeof entry.body['match'] !== 'string' || !entry.body['match'])) {
      issues.push(issue('missing_field', `${path}.match`, 'Egern 规则缺少 match', 'The Egern rule is missing match.'))
    }
    const policy = entry.body['policy']
    if (typeof policy !== 'string' || !targets.has(policy)) {
      issues.push(issue(
        'missing_reference',
        `${path}.policy`,
        `规则引用了不存在的策略 ${String(policy)}`,
        `A rule references the missing policy ${String(policy)}.`
      ))
    }
  }
  return issues
}

function unwrapEgernEntry(
  value: unknown,
  path: string,
  allowedTypes: ReadonlySet<string>,
  label: string,
  labelEn: string,
  issues: ExportArtifactValidationIssue[]
): { type: string; body: RecordValue } | null {
  const entry = asRecord(value)
  const keys = entry ? Object.keys(entry) : []
  if (!entry || keys.length !== 1 || !allowedTypes.has(keys[0]!)) {
    issues.push(issue(
      'invalid_entry',
      path,
      `Egern ${label}必须是单个原生类型键包裹的对象`,
      `An Egern ${labelEn} must be wrapped by exactly one native type key.`
    ))
    return null
  }
  const type = keys[0]!
  const body = asRecord(entry[type])
  if (!body) {
    issues.push(issue('invalid_entry', `${path}.${type}`, `Egern ${label}内容必须是对象`, `The Egern ${labelEn} body must be an object.`))
    return null
  }
  return { type, body }
}

function collectEgernName(
  body: RecordValue,
  path: string,
  names: Set<string>,
  label: string,
  labelEn: string,
  issues: ExportArtifactValidationIssue[]
): void {
  const name = body['name']
  if (typeof name !== 'string' || !name) {
    issues.push(issue('missing_name', path, `${label}缺少名称`, `The ${labelEn} is missing a name.`))
  } else if (names.has(name)) {
    issues.push(issue('duplicate_name', path, `${label}名称 ${name} 重复`, `${labelEn} name ${name} is duplicated.`))
  } else {
    names.add(name)
  }
}

function validateEgernProxyBody(
  type: string,
  body: RecordValue,
  path: string,
  issues: ExportArtifactValidationIssue[]
): void {
  if (typeof body['server'] !== 'string' || !body['server']) {
    issues.push(issue('missing_field', `${path}.server`, 'Egern 节点缺少 server', 'The Egern proxy is missing server.'))
  }
  const port = Number(body['port'])
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push(issue('invalid_value', `${path}.port`, 'Egern 节点端口无效', 'The Egern proxy port is invalid.'))
  }
  const requiredByType: Record<string, string[]> = {
    shadowsocks: ['method', 'password'],
    trojan: ['password'],
    anytls: ['password'],
    hysteria2: ['auth'],
    tuic: ['uuid', 'password'],
    vmess: ['user_id', 'security'],
    vless: ['user_id'],
    ssh: ['username'],
    wireguard: ['private_key', 'peer_public_key'],
    snell: ['psk'],
  }
  for (const field of requiredByType[type] ?? []) {
    if (typeof body[field] === 'string' && body[field]) continue
    issues.push(issue('missing_field', `${path}.${field}`, `Egern ${type} 节点缺少 ${field}`, `The Egern ${type} proxy is missing ${field}.`))
  }
  if (type === 'wireguard' && !body['local_ipv4'] && !body['local_ipv6']) {
    issues.push(issue('missing_field', `${path}.local_ipv4`, 'Egern WireGuard 至少需要一个本地地址', 'Egern WireGuard requires at least one local address.'))
  }
}

function validateTextClientReferences(
  format: ExportFormat,
  sections: ReadonlyMap<string, string[]>
): ExportArtifactValidationIssue[] {
  const issues: ExportArtifactValidationIssue[] = []
  const proxyLines = sections.get('proxy') ?? []
  const proxyNames = collectIniEntryNames(proxyLines, 'proxy', issues)
  if (format === 'surge') issues.push(...validateSurgeProxyEntries(proxyLines))
  if (format === 'loon') issues.push(...validateLoonProxyEntries(proxyLines))
  const groupLines = sections.get('proxy group') ?? []
  const groupNames = collectIniEntryNames(groupLines, 'proxy group', issues)
  const targets = new Set([...proxyNames, ...groupNames, 'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS'])

  for (const [index, line] of groupLines.entries()) {
    const assignment = splitAssignment(line)
    if (!assignment) continue
    const values = splitIniCsv(assignment.value)
    if (format === 'loon' && !['select', 'url-test', 'fallback', 'load-balance'].includes(values[0]?.toLowerCase() ?? '')) {
      issues.push(issue(
        'invalid_entry',
        `proxy group[${index}]`,
        `Loon 策略组类型 ${values[0] || '(empty)'} 无效`,
        `The Loon proxy group type ${values[0] || '(empty)'} is invalid.`
      ))
    }
    const members = values.slice(1).filter(item => !item.includes('='))
    if (members.length === 0) {
      issues.push(issue('empty_section', `proxy group[${index}]`, `策略组 ${assignment.name} 没有成员`, `Proxy group ${assignment.name} has no members.`))
    }
    for (const member of members) {
      if (targets.has(member)) continue
      issues.push(issue('missing_reference', `proxy group[${index}]`, `策略组引用了不存在的成员 ${member}`, `A proxy group references the missing member ${member}.`))
    }
  }
  const ruleLines = sections.get('rule') ?? []
  issues.push(...validateTextRuleTargets(ruleLines, 'rule', targets))
  if (format === 'surge') {
    for (const [index, line] of ruleLines.entries()) {
      const values = line.split(',').map(item => item.trim()).filter(Boolean)
      if (values[0]?.toUpperCase() !== 'RULE-SET') continue
      if (!values[1] || !isHttpUrl(values[1])) {
        issues.push(issue(
          'invalid_url',
          `rule[${index}]`,
          'Surge RULE-SET 必须直接引用有效的 http(s) URL',
          'A Surge RULE-SET entry must directly reference a valid HTTP(S) URL.'
        ))
      }
    }
  }
  for (const section of ['remote rule']) {
    for (const [index, line] of (sections.get(section) ?? []).entries()) {
      const policy = line.match(/(?:^|,\s*)policy\s*=\s*([^,]+)/i)?.[1]?.trim()
      if (!policy || targets.has(policy)) continue
      issues.push(issue('missing_reference', `${section}[${index}]`, `远程规则集引用了不存在的策略 ${policy}`, `A remote rule set references the missing policy ${policy}.`))
    }
  }
  return issues
}

const SURGE_PROXY_PROTOCOLS = new Set([
  'http', 'https', 'socks5', 'ss', 'vmess', 'trojan', 'hysteria2', 'anytls',
  'ssh', 'wireguard', 'snell', 'trust-tunnel',
])

function validateSurgeProxyEntries(lines: string[]): ExportArtifactValidationIssue[] {
  const issues: ExportArtifactValidationIssue[] = []
  for (const [index, line] of lines.entries()) {
    const path = `proxy[${index}]`
    const assignment = splitAssignment(line)
    if (!assignment) continue
    const values = assignment.value.split(',').map(item => item.trim())
    const protocol = values[0]?.toLowerCase() ?? ''
    if (!SURGE_PROXY_PROTOCOLS.has(protocol)) {
      issues.push(issue('invalid_entry', path, `Surge 节点协议 ${protocol || '(empty)'} 无效`, `The Surge proxy protocol ${protocol || '(empty)'} is invalid.`))
      continue
    }
    const parameters = new Set(values.slice(1).map(value => value.split('=', 1)[0]?.toLowerCase()))
    if (protocol === 'wireguard') {
      if (!parameters.has('section-name')) {
        issues.push(issue('missing_field', path, 'Surge WireGuard 节点缺少 section-name', 'The Surge WireGuard proxy is missing section-name.'))
      }
      continue
    }
    const host = values[1] ?? ''
    const port = Number(values[2])
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      issues.push(issue('invalid_value', path, 'Surge 节点缺少有效的主机和端口', 'The Surge proxy entry is missing a valid host and port.'))
    }
    const proxyParameters = new Set(values.slice(3).map(value => value.split('=', 1)[0]?.toLowerCase()))
    if (protocol === 'http' && proxyParameters.has('tls')) {
      issues.push(issue('invalid_entry', path, 'Surge HTTPS 节点必须使用 https 类型，不能使用 http + tls=true', 'A Surge HTTPS proxy must use the https type, not http with tls=true.'))
    }
    let required: string[] = []
    if (protocol === 'ss') required = ['encrypt-method', 'password']
    else if (protocol === 'vmess' || protocol === 'ssh') required = ['username']
    else if (protocol === 'snell') required = ['psk', 'version']
    else if (protocol === 'trust-tunnel') required = ['username', 'password']
    else if (['trojan', 'hysteria2', 'anytls'].includes(protocol)) required = ['password']
    for (const parameter of required) {
      if (proxyParameters.has(parameter)) continue
      issues.push(issue('missing_field', path, `Surge ${protocol} 节点缺少 ${parameter}`, `The Surge ${protocol} proxy is missing ${parameter}.`))
    }
  }
  return issues
}

const LOON_PROXY_PROTOCOLS = new Set([
  'shadowsocks', 'shadowsocksr', 'vmess', 'vless', 'trojan',
  'hysteria2', 'anytls', 'http', 'https', 'socks5', 'wireguard',
])

function validateLoonProxyEntries(lines: string[]): ExportArtifactValidationIssue[] {
  const issues: ExportArtifactValidationIssue[] = []
  for (const [index, line] of lines.entries()) {
    const path = `proxy[${index}]`
    const assignment = splitAssignment(line)
    if (!assignment) continue
    const values = splitIniCsv(assignment.value)
    const protocol = values[0]?.toLowerCase() ?? ''
    if (!LOON_PROXY_PROTOCOLS.has(protocol)) {
      issues.push(issue('invalid_entry', path, `Loon 节点协议 ${protocol || '(empty)'} 无效`, `The Loon proxy protocol ${protocol || '(empty)'} is invalid.`))
      continue
    }
    if (protocol === 'wireguard') {
      const parameters = new Set(values.slice(1).map(value => value.split('=', 1)[0]?.toLowerCase()))
      for (const parameter of ['private-key', 'peers']) {
        if (parameters.has(parameter)) continue
        issues.push(issue('missing_field', path, `Loon WireGuard 节点缺少 ${parameter}`, `The Loon WireGuard proxy is missing ${parameter}.`))
      }
      if (!parameters.has('interface-ip') && !parameters.has('interface-ipv6')) {
        issues.push(issue('missing_field', path, 'Loon WireGuard 节点缺少本地地址', 'The Loon WireGuard proxy is missing a local address.'))
      }
      continue
    }
    const host = values[1] ?? ''
    const port = Number(values[2])
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      issues.push(issue('invalid_value', path, 'Loon 节点缺少有效的主机和端口', 'The Loon proxy entry is missing a valid host and port.'))
    }
    const minimumFields = ['shadowsocks', 'shadowsocksr', 'vmess'].includes(protocol)
      ? 5
      : ['vless', 'trojan', 'hysteria2', 'anytls'].includes(protocol)
        ? 4
        : 3
    if (values.length < minimumFields) {
      issues.push(issue('missing_field', path, `Loon ${protocol} 节点字段不完整`, `The Loon ${protocol} proxy is missing required positional fields.`))
      continue
    }
    if (protocol === 'shadowsocks' && values[3]?.includes('=')) {
      issues.push(issue('invalid_entry', path, 'Loon Shadowsocks 必须使用位置式加密方式和密码字段', 'Loon Shadowsocks requires positional cipher and password fields.'))
    }
    if (protocol === 'vmess' && values[3]?.includes('=')) {
      issues.push(issue('invalid_entry', path, 'Loon VMess 必须使用位置式加密方式和 UUID 字段', 'Loon VMess requires positional cipher and UUID fields.'))
    }
    if (protocol === 'anytls' && values[3]?.includes('=')) {
      issues.push(issue('invalid_entry', path, 'Loon AnyTLS 必须使用位置式密码字段', 'Loon AnyTLS requires a positional password field.'))
    }
    const parameters = new Set(values.slice(minimumFields).map(value => value.split('=', 1)[0]?.toLowerCase()))
    if (parameters.has('tls-name')) {
      issues.push(issue(
        'invalid_entry',
        path,
        'Loon TLS 服务器名称必须使用 sni 参数',
        'The Loon TLS server name must use the sni parameter.'
      ))
    }
    if (protocol === 'http' && (parameters.has('over-tls') || parameters.has('tls'))) {
      issues.push(issue('invalid_entry', path, 'Loon HTTPS 节点必须使用 https 类型', 'A Loon HTTPS proxy must use the https type.'))
    }
    if (['vmess', 'vless'].includes(protocol)) {
      for (const parameter of ['transport', 'over-tls']) {
        if (parameters.has(parameter)) continue
        issues.push(issue('missing_field', path, `Loon ${protocol} 节点缺少 ${parameter}`, `The Loon ${protocol} proxy is missing ${parameter}.`))
      }
    }
    if (['vmess', 'vless', 'trojan'].includes(protocol)) {
      const transport = values
        .slice(minimumFields)
        .find(value => value.toLowerCase().startsWith('transport='))
        ?.split('=', 2)[1]
      if (transport && !['tcp', 'ws', 'http'].includes(transport.toLowerCase())) {
        issues.push(issue('invalid_value', path, `Loon 不支持 ${transport} 传输层`, `Loon does not support the ${transport} transport in this exporter.`))
      }
    }
  }
  return issues
}

function splitIniCsv(value: string): string[] {
  const fields: string[] = []
  let current = ''
  let quoted = false
  let escaped = false
  for (const char of value) {
    if (escaped) {
      current += char
      escaped = false
    } else if (char === '\\' && quoted) {
      escaped = true
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      fields.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current.trim())
  return fields
}

function validateQuantumultXReferences(sections: ReadonlyMap<string, string[]>): ExportArtifactValidationIssue[] {
  const issues: ExportArtifactValidationIssue[] = []
  const nodeNames = collectQuantumultXNodes(sections.get('server_local') ?? [], issues)
  const policyLines = sections.get('policy') ?? []
  const policyNames = new Set<string>()
  const parsedPolicies: Array<{ name: string; members: string[]; index: number }> = []
  for (const [index, line] of policyLines.entries()) {
    const assignment = splitAssignment(line)
    if (!assignment) {
      issues.push(issue('invalid_entry', `policy[${index}]`, '策略行格式无效', 'The policy line is malformed.'))
      continue
    }
    const policyType = assignment.name.toLowerCase()
    if (!['static', 'available', 'round-robin', 'url-latency-benchmark'].includes(policyType)) {
      issues.push(issue(
        'invalid_entry',
        `policy[${index}]`,
        `Quantumult X 策略类型 ${assignment.name} 无效`,
        `The Quantumult X policy type ${assignment.name} is invalid.`
      ))
    }
    const values = assignment.value.split(',').map(item => item.trim()).filter(Boolean)
    if (
      policyType === 'url-latency-benchmark'
      && values.some(value => /^(?:interval|url)\s*=/i.test(value))
    ) {
      issues.push(issue(
        'invalid_entry',
        `policy[${index}]`,
        'Quantumult X 自动测速策略应使用全局 server_check_url 和 check-interval 参数',
        'A Quantumult X latency policy must use the global server_check_url and the check-interval parameter.'
      ))
    }
    const name = values.shift() ?? ''
    if (!name) {
      issues.push(issue('missing_name', `policy[${index}]`, '策略组缺少名称', 'A policy group is missing its name.'))
      continue
    }
    if (policyNames.has(name)) {
      issues.push(issue('duplicate_name', `policy[${index}]`, `策略组名称 ${name} 重复`, `Policy group name ${name} is duplicated.`))
    }
    policyNames.add(name)
    parsedPolicies.push({ name, members: values.filter(item => !item.includes('=')), index })
  }
  const targets = new Set([...nodeNames, ...policyNames, 'DIRECT', 'REJECT'])
  for (const policy of parsedPolicies) {
    if (policy.members.length === 0) {
      issues.push(issue('empty_section', `policy[${policy.index}]`, `策略组 ${policy.name} 没有成员`, `Policy group ${policy.name} has no members.`))
    }
    for (const member of policy.members) {
      if (targets.has(member)) continue
      issues.push(issue('missing_reference', `policy[${policy.index}]`, `策略组引用了不存在的成员 ${member}`, `A policy group references the missing member ${member}.`))
    }
  }
  issues.push(...validateTextRuleTargets(sections.get('filter_local') ?? [], 'filter_local', targets))
  for (const [index, line] of (sections.get('filter_remote') ?? []).entries()) {
    const policy = line.match(/(?:^|,\s*)force-policy\s*=\s*([^,]+)/i)?.[1]?.trim()
    if (!policy || targets.has(policy)) continue
    issues.push(issue('missing_reference', `filter_remote[${index}]`, `远程规则集引用了不存在的策略 ${policy}`, `A remote rule set references the missing policy ${policy}.`))
  }
  return issues
}

const QUANTUMULT_X_SERVER_PROTOCOLS = new Set([
  'shadowsocks', 'vmess', 'vless', 'trojan', 'anytls', 'http', 'socks5',
])

function collectQuantumultXNodes(
  lines: string[],
  issues: ExportArtifactValidationIssue[]
): Set<string> {
  const names = new Set<string>()
  for (const [index, line] of lines.entries()) {
    const path = `server_local[${index}]`
    if (line.includes('://')) {
      issues.push(issue(
        'invalid_entry',
        path,
        'Quantumult X 的 [server_local] 必须使用原生节点行，不能使用订阅 URI',
        'Quantumult X [server_local] requires native server entries, not subscription URIs.'
      ))
      continue
    }
    const assignment = splitAssignment(line)
    if (!assignment || !QUANTUMULT_X_SERVER_PROTOCOLS.has(assignment.name.toLowerCase())) {
      issues.push(issue('invalid_entry', path, 'Quantumult X 节点类型或语法无效', 'The Quantumult X server type or syntax is invalid.'))
      continue
    }
    const fields = assignment.value.split(',').map(item => item.trim()).filter(Boolean)
    if (!isHostPort(fields[0] ?? '')) {
      issues.push(issue('invalid_value', path, 'Quantumult X 节点缺少有效的主机和端口', 'The Quantumult X server entry is missing a valid host and port.'))
    }
    const tag = fields
      .map(field => field.match(/^tag\s*=\s*(.+)$/i)?.[1]?.trim())
      .find((value): value is string => Boolean(value))
    if (!tag) {
      issues.push(issue('missing_name', path, 'Quantumult X 节点缺少 tag', 'The Quantumult X server entry is missing its tag.'))
    } else if (names.has(tag)) {
      issues.push(issue('duplicate_name', path, `Quantumult X 节点 tag ${tag} 重复`, `Quantumult X server tag ${tag} is duplicated.`))
    } else {
      names.add(tag)
    }
  }
  return names
}

function isHostPort(value: string): boolean {
  const match = value.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/)
  if (!match) return false
  const port = Number(match[3])
  return port >= 1 && port <= 65535 && Boolean(match[1] ?? match[2])
}

function validateTextRuleTargets(
  lines: string[],
  path: string,
  targets: ReadonlySet<string>
): ExportArtifactValidationIssue[] {
  const issues: ExportArtifactValidationIssue[] = []
  for (const [index, line] of lines.entries()) {
    const values = line.split(',').map(item => item.trim()).filter(Boolean)
    const trailingOptions = new Set(['no-resolve', 'force-remote-dns'])
    let targetIndex = values.length - 1
    while (targetIndex >= 0 && trailingOptions.has(values[targetIndex]!.toLowerCase())) {
      targetIndex -= 1
    }
    const target = values[targetIndex]
    if (target && targets.has(target)) continue
    issues.push(issue('missing_reference', `${path}[${index}]`, `规则引用了不存在的策略 ${String(target)}`, `A rule references the missing policy ${String(target)}.`))
  }
  return issues
}

function collectIniEntryNames(
  lines: string[],
  path: string,
  issues: ExportArtifactValidationIssue[]
): Set<string> {
  const names = new Set<string>()
  for (const [index, line] of lines.entries()) {
    const assignment = splitAssignment(line)
    if (!assignment) {
      issues.push(issue('invalid_entry', `${path}[${index}]`, `${path} 条目格式无效`, `The ${path} entry is malformed.`))
      continue
    }
    if (names.has(assignment.name)) {
      issues.push(issue('duplicate_name', `${path}[${index}]`, `${path} 名称 ${assignment.name} 重复`, `${path} name ${assignment.name} is duplicated.`))
    }
    names.add(assignment.name)
  }
  return names
}

function splitAssignment(line: string): { name: string; value: string } | null {
  const separator = line.indexOf('=')
  if (separator <= 0) return null
  const name = line.slice(0, separator).trim()
  const value = line.slice(separator + 1).trim()
  return name && value ? { name, value } : null
}

function validateEgernRemoteRule(
  value: unknown,
  index: number,
  targets: ReadonlySet<string>
): ExportArtifactValidationIssue[] {
  const path = `rules[${index}].rule_set`
  const remote = asRecord(value)
  if (!remote) {
    return [issue('invalid_entry', path, 'rule_set 必须是包含 match 和 policy 的对象', 'rule_set must be an object containing match and policy.')]
  }
  const issues: ExportArtifactValidationIssue[] = []
  const match = remote['match']
  if (typeof match !== 'string' || !isHttpUrl(match)) {
    issues.push(issue('invalid_url', `${path}.match`, '远程规则集 match 必须是 http(s) URL', 'A remote rule-set match must be an HTTP(S) URL.'))
  }
  const policy = remote['policy']
  if (typeof policy !== 'string' || !targets.has(policy)) {
    issues.push(issue('missing_reference', `${path}.policy`, `远程规则集引用了不存在的策略 ${String(policy)}`, `A remote rule set references the missing policy ${String(policy)}.`))
  }
  const interval = remote['update_interval']
  if (interval !== undefined && (typeof interval !== 'number' || !Number.isInteger(interval) || interval <= 0)) {
    issues.push(issue('invalid_value', `${path}.update_interval`, '远程规则集更新间隔必须是正整数', 'A remote rule-set update interval must be a positive integer.'))
  }
  return issues
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

function parseStructuredDocument(
  format: ExportFormat,
  kind: 'yaml' | 'json',
  content: string,
  parser: (content: string) => unknown
): { value: RecordValue | null; result: ExportArtifactValidationResult } {
  try {
    const value = asRecord(parser(content))
    if (!value) {
      return { value: null, result: result(format, kind, [issue('invalid_root', undefined, '配置根节点必须是对象', 'The config root must be an object.')]) }
    }
    return { value, result: result(format, kind, []) }
  } catch {
    return { value: null, result: result(format, kind, [issue('parse_error', undefined, `配置不是有效的 ${kind.toUpperCase()}`, `The config is not valid ${kind.toUpperCase()}.`)]) }
  }
}

function requireNonEmptyArray(record: RecordValue, key: string, path = key): ExportArtifactValidationIssue[] {
  const value = record[key]
  if (!Array.isArray(value)) return [issue('missing_section', path, `缺少 ${path} 数组`, `Missing the ${path} array.`)]
  if (value.length === 0) return [issue('empty_section', path, `${path} 数组为空`, `The ${path} array is empty.`)]
  return []
}

function parseIniSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current: string | null = null
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const header = line.match(/^\[([^\]]+)\]$/)
    if (header) {
      current = header[1]!.trim().toLowerCase()
      if (!sections.has(current)) sections.set(current, [])
      continue
    }
    if (current) sections.get(current)!.push(line)
  }
  return sections
}

function decodeBase64Utf8(value: string): string {
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
}

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null
}

function result(
  format: ExportFormat,
  kind: ExportArtifactValidationResult['kind'],
  issues: ExportArtifactValidationIssue[]
): ExportArtifactValidationResult {
  return { format, kind, valid: issues.length === 0, issues }
}

function issue(
  code: string,
  path: string | undefined,
  message: string,
  messageEn: string
): ExportArtifactValidationIssue {
  return { code, ...(path ? { path } : {}), message, messageEn }
}
