import { Unzlib } from 'fflate'

export interface SingboxSrsResult {
  version: number
  rules: Record<string, unknown>[]
}

const MAGIC = [0x53, 0x52, 0x53]
const CURRENT_VERSION = 5
const DEFAULT_MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_VALUES = 1_000_000
const MAX_LOGICAL_DEPTH = 64

const RULE_ITEM = {
  queryType: 0,
  network: 1,
  domain: 2,
  domainKeyword: 3,
  domainRegex: 4,
  sourceIpCidr: 5,
  ipCidr: 6,
  sourcePort: 7,
  sourcePortRange: 8,
  port: 9,
  portRange: 10,
  processName: 11,
  processPath: 12,
  packageName: 13,
  wifiSsid: 14,
  wifiBssid: 15,
  adguardDomain: 16,
  processPathRegex: 17,
  networkType: 18,
  networkIsExpensive: 19,
  networkIsConstrained: 20,
  networkInterfaceAddress: 21,
  defaultInterfaceAddress: 22,
  packageNameRegex: 23,
  final: 0xff,
} as const

const INTERFACE_TYPES = ['wifi', 'cellular', 'ethernet', 'other'] as const
const PREFIX_LABEL = '\r'
const ROOT_LABEL = '\n'
const ADGUARD_SUFFIX_LABEL = '\b'

export function isSingboxSrs(input: Uint8Array): boolean {
  return input.byteLength >= MAGIC.length && MAGIC.every((byte, index) => input[index] === byte)
}

export function parseSingboxSrs(
  input: Uint8Array,
  options: {
    maxDecompressedBytes?: number
    maxValues?: number
  } = {},
): SingboxSrsResult {
  if (input.byteLength < 5) throw new Error('SRS file is too short')
  if (!isSingboxSrs(input)) throw new Error('Invalid SRS magic')
  const version = input[3]!
  if (version < 1 || version > CURRENT_VERSION) throw new Error(`Unsupported SRS version ${version}`)

  const decompressed = decompressZlibLimited(
    input.subarray(4),
    options.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES,
  )
  const reader = new SrsReader(decompressed, options.maxValues ?? DEFAULT_MAX_VALUES)
  const ruleCount = reader.readCount('rule count')
  const rules: Record<string, unknown>[] = []
  for (let index = 0; index < ruleCount; index += 1) {
    rules.push(readRule(reader, version, 0))
  }
  if (!reader.done) throw new Error('SRS contains trailing data')
  return { version, rules }
}

function decompressZlibLimited(input: Uint8Array, maxBytes: number): Uint8Array {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid SRS decompressed size limit')
  const chunks: Uint8Array[] = []
  let total = 0
  let completed = false
  const decompressor = new Unzlib((chunk, final) => {
    total += chunk.byteLength
    if (total > maxBytes) throw new Error('Decompressed SRS exceeds the safety limit')
    chunks.push(chunk)
    completed ||= final
  })
  decompressor.push(input, true)
  if (!completed) throw new Error('Incomplete SRS zlib stream')

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function readRule(reader: SrsReader, version: number, depth: number): Record<string, unknown> {
  if (depth > MAX_LOGICAL_DEPTH) throw new Error('SRS logical rule nesting is too deep')
  const type = reader.readUint8()
  if (type === 0) return readDefaultRule(reader, version)
  if (type !== 1) throw new Error(`Unknown SRS rule type ${type}`)

  const modeByte = reader.readUint8()
  if (modeByte !== 0 && modeByte !== 1) throw new Error(`Unknown SRS logical mode ${modeByte}`)
  const count = reader.readCount('logical rule count')
  const rules: Record<string, unknown>[] = []
  for (let index = 0; index < count; index += 1) rules.push(readRule(reader, version, depth + 1))
  const result: Record<string, unknown> = {
    type: 'logical',
    mode: modeByte === 0 ? 'and' : 'or',
    rules,
  }
  if (reader.readBool()) result.invert = true
  return result
}

function readDefaultRule(reader: SrsReader, version: number): Record<string, unknown> {
  const rule: Record<string, unknown> = {}
  while (true) {
    const item = reader.readUint8()
    switch (item) {
      case RULE_ITEM.queryType:
        rule.query_type = reader.readUint16List()
        break
      case RULE_ITEM.network:
        rule.network = reader.readStringList()
        break
      case RULE_ITEM.domain: {
        const matcher = readDomainMatcher(reader)
        if (matcher.domain.length > 0) rule.domain = matcher.domain
        if (matcher.domainSuffix.length > 0) rule.domain_suffix = matcher.domainSuffix
        break
      }
      case RULE_ITEM.domainKeyword:
        rule.domain_keyword = reader.readStringList()
        break
      case RULE_ITEM.domainRegex:
        rule.domain_regex = reader.readStringList()
        break
      case RULE_ITEM.sourceIpCidr:
        rule.source_ip_cidr = readIpSet(reader)
        break
      case RULE_ITEM.ipCidr:
        rule.ip_cidr = readIpSet(reader)
        break
      case RULE_ITEM.sourcePort:
        rule.source_port = reader.readUint16List()
        break
      case RULE_ITEM.sourcePortRange:
        rule.source_port_range = reader.readStringList()
        break
      case RULE_ITEM.port:
        rule.port = reader.readUint16List()
        break
      case RULE_ITEM.portRange:
        rule.port_range = reader.readStringList()
        break
      case RULE_ITEM.processName:
        rule.process_name = reader.readStringList()
        break
      case RULE_ITEM.processPath:
        rule.process_path = reader.readStringList()
        break
      case RULE_ITEM.packageName:
        rule.package_name = reader.readStringList()
        break
      case RULE_ITEM.wifiSsid:
        rule.wifi_ssid = reader.readStringList()
        break
      case RULE_ITEM.wifiBssid:
        rule.wifi_bssid = reader.readStringList()
        break
      case RULE_ITEM.adguardDomain:
        requireVersion(version, 2, 'adguard_domain')
        rule.adguard_domain = readAdGuardMatcher(reader)
        break
      case RULE_ITEM.processPathRegex:
        rule.process_path_regex = reader.readStringList()
        break
      case RULE_ITEM.networkType:
        requireVersion(version, 3, 'network_type')
        rule.network_type = reader.readUint8List().map(value => INTERFACE_TYPES[value] ?? value)
        break
      case RULE_ITEM.networkIsExpensive:
        requireVersion(version, 3, 'network_is_expensive')
        rule.network_is_expensive = true
        break
      case RULE_ITEM.networkIsConstrained:
        requireVersion(version, 3, 'network_is_constrained')
        rule.network_is_constrained = true
        break
      case RULE_ITEM.networkInterfaceAddress:
        requireVersion(version, 4, 'network_interface_address')
        rule.network_interface_address = readNetworkInterfaceAddresses(reader)
        break
      case RULE_ITEM.defaultInterfaceAddress:
        requireVersion(version, 4, 'default_interface_address')
        rule.default_interface_address = readPrefixList(reader)
        break
      case RULE_ITEM.packageNameRegex:
        requireVersion(version, 5, 'package_name_regex')
        rule.package_name_regex = reader.readStringList()
        break
      case RULE_ITEM.final:
        if (reader.readBool()) rule.invert = true
        return rule
      default:
        throw new Error(`Unknown SRS rule item ${item}`)
    }
  }
}

function requireVersion(version: number, minimum: number, item: string): void {
  if (version < minimum) throw new Error(`${item} is not valid in SRS version ${version}`)
}

function readDomainMatcher(reader: SrsReader): { domain: string[]; domainSuffix: string[] } {
  const keys = readSuccinctKeys(reader)
  const domain = new Set<string>()
  const rawPrefixes = new Set<string>()
  const domainSuffix: string[] = []
  for (const rawKey of keys) {
    const key = reverseRunes(rawKey)
    if (key.startsWith(PREFIX_LABEL)) rawPrefixes.add(key.slice(1))
    else if (key.startsWith(ROOT_LABEL)) domainSuffix.push(key.slice(1))
    else domain.add(key)
  }
  for (const prefix of rawPrefixes) {
    if (prefix.startsWith('.') && domain.delete(prefix.slice(1))) domainSuffix.push(prefix.slice(1))
    else domainSuffix.push(prefix)
  }
  return {
    domain: [...domain].sort(),
    domainSuffix: [...new Set(domainSuffix)].sort(),
  }
}

function readAdGuardMatcher(reader: SrsReader): string[] {
  return readSuccinctKeys(reader).map((rawKey) => {
    let key = reverseRunes(rawKey)
    let suffix = false
    let start = false
    let end = false
    if (key.startsWith(PREFIX_LABEL)) key = key.slice(1)
    else if (key.startsWith(ROOT_LABEL)) {
      key = key.slice(1)
      suffix = true
    } else {
      start = true
    }
    if (key.endsWith(ADGUARD_SUFFIX_LABEL)) key = key.slice(0, -1)
    else end = true
    if (suffix) key = `||${key}`
    else if (start) key = `|${key}`
    if (end) key += '^'
    return key
  })
}

function readSuccinctKeys(reader: SrsReader): string[] {
  reader.readUint8() // Internal matcher version; the official reader currently reserves this byte.
  const leaves = reader.readUint64Words()
  const labelBitmap = reader.readUint64Words()
  const labels = reader.readBytes(reader.readCount('matcher label count'))
  const children: Array<Array<{ label: number; nodeId: number }>> = []
  let bitmapIndex = 0
  let labelIndex = 0
  let nextNodeId = 1
  for (let nodeId = 0; nodeId < nextNodeId; nodeId += 1) {
    const nodeChildren: Array<{ label: number; nodeId: number }> = []
    while (!getWordBit(labelBitmap, bitmapIndex)) {
      if (labelIndex >= labels.byteLength) throw new Error('Invalid SRS matcher labels')
      nodeChildren.push({ label: labels[labelIndex]!, nodeId: nextNodeId })
      labelIndex += 1
      nextNodeId += 1
      bitmapIndex += 1
    }
    bitmapIndex += 1
    children.push(nodeChildren)
  }
  if (labelIndex !== labels.byteLength) throw new Error('Invalid SRS matcher bitmap')

  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  const keys: string[] = []
  const path: number[] = []
  const visit = (nodeId: number): void => {
    if (getWordBit(leaves, nodeId)) {
      keys.push(decoder.decode(Uint8Array.from(path)))
    }
    for (const child of children[nodeId] ?? []) {
      path.push(child.label)
      visit(child.nodeId)
      path.pop()
    }
  }
  visit(0)
  return keys
}

function readIpSet(reader: SrsReader): string[] {
  if (reader.readUint8() !== 1) throw new Error('Unsupported SRS IP-set version')
  const rangeCount = reader.readUint64Length('IP range count')
  const result: string[] = []
  for (let index = 0; index < rangeCount; index += 1) {
    const start = reader.readAddress()
    const end = reader.readAddress()
    if (start.byteLength !== end.byteLength) throw new Error('Invalid mixed-family SRS IP range')
    const cidrs = rangeToCidrs(bytesToBigInt(start), bytesToBigInt(end), start.byteLength === 4 ? 32 : 128)
    result.push(...cidrs)
    reader.consumeValue(cidrs.length)
  }
  return result
}

function readNetworkInterfaceAddresses(reader: SrsReader): Record<string, string[]> {
  const count = reader.readCount('network interface address count')
  const result: Record<string, string[]> = {}
  for (let index = 0; index < count; index += 1) {
    const type = reader.readUint8()
    result[INTERFACE_TYPES[type] ?? String(type)] = readPrefixList(reader)
  }
  return result
}

function readPrefixList(reader: SrsReader): string[] {
  const count = reader.readCount('prefix count')
  return Array.from({ length: count }, () => reader.readPrefix())
}

function rangeToCidrs(startValue: bigint, end: bigint, width: 32 | 128): string[] {
  if (startValue > end) throw new Error('Invalid SRS IP range')
  const result: string[] = []
  let start = startValue
  while (start <= end) {
    const alignmentBits = start === 0n ? width : Math.min(countTrailingZeros(start), width)
    const capacityBits = floorLog2(end - start + 1n)
    const hostBits = Math.min(alignmentBits, capacityBits)
    result.push(`${formatIp(start, width)}/${width - hostBits}`)
    start += 1n << BigInt(hostBits)
  }
  return result
}

function countTrailingZeros(value: bigint): number {
  let count = 0
  while ((value & 1n) === 0n) {
    count += 1
    value >>= 1n
  }
  return count
}

function floorLog2(value: bigint): number {
  let result = -1
  while (value > 0n) {
    value >>= 1n
    result += 1
  }
  return result
}

function formatIp(value: bigint, width: 32 | 128): string {
  if (width === 32) {
    return [24n, 16n, 8n, 0n].map(shift => Number((value >> shift) & 0xffn)).join('.')
  }
  const groups = Array.from({ length: 8 }, (_, index) =>
    Number((value >> BigInt((7 - index) * 16)) & 0xffffn),
  )
  let bestStart = -1
  let bestLength = 0
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1
      continue
    }
    let end = index
    while (end < groups.length && groups[end] === 0) end += 1
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index
      bestLength = end - index
    }
    index = end
  }
  if (bestStart < 0) return groups.map(group => group.toString(16)).join(':')
  const before = groups.slice(0, bestStart).map(group => group.toString(16)).join(':')
  const after = groups.slice(bestStart + bestLength).map(group => group.toString(16)).join(':')
  return `${before}::${after}`
}

function reverseRunes(value: string): string {
  return Array.from(value).reverse().join('')
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

function getWordBit(words: Uint8Array, bitIndex: number): boolean {
  const wordIndex = Math.floor(bitIndex / 64)
  const bitInWord = bitIndex % 64
  const byteIndex = wordIndex * 8 + 7 - Math.floor(bitInWord / 8)
  if (byteIndex >= words.byteLength) throw new Error('Invalid SRS bitmap')
  return (words[byteIndex]! & (1 << (bitInWord % 8))) !== 0
}

class SrsReader {
  private offset = 0
  private consumedValues = 0
  private readonly value: Uint8Array
  private readonly maxValues: number

  constructor(value: Uint8Array, maxValues: number) {
    this.value = value
    this.maxValues = maxValues
    if (!Number.isSafeInteger(maxValues) || maxValues <= 0) throw new Error('Invalid SRS value limit')
  }

  get done(): boolean {
    return this.offset === this.value.byteLength
  }

  readUint8(): number {
    return this.readBytes(1)[0]!
  }

  readBool(): boolean {
    const value = this.readUint8()
    if (value !== 0 && value !== 1) throw new Error('Invalid SRS boolean')
    return value === 1
  }

  readCount(label: string): number {
    const count = this.readUvarint(label)
    this.consumeValue(count)
    return count
  }

  readUint64Length(label: string): number {
    const value = bytesToBigInt(this.readBytes(8))
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid ${label}`)
    const count = Number(value)
    this.consumeValue(count)
    return count
  }

  readStringList(): string[] {
    const count = this.readCount('string count')
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
    return Array.from({ length: count }, () =>
      decoder.decode(this.readBytes(this.readUvarint('string length'))),
    )
  }

  readUint8List(): number[] {
    const count = this.readCount('uint8 count')
    return [...this.readBytes(count)]
  }

  readUint16List(): number[] {
    const count = this.readCount('uint16 count')
    return Array.from({ length: count }, () => {
      const bytes = this.readBytes(2)
      return bytes[0]! * 256 + bytes[1]!
    })
  }

  readUint64Words(): Uint8Array {
    const count = this.readCount('bitmap word count')
    if (count > Math.floor((this.value.byteLength - this.offset) / 8)) throw new Error('Invalid SRS bitmap length')
    return this.readBytes(count * 8)
  }

  readAddress(): Uint8Array {
    const length = this.readUvarint('IP address length')
    if (length !== 4 && length !== 16) throw new Error('Invalid SRS IP address length')
    return this.readBytes(length)
  }

  readPrefix(): string {
    const address = this.readAddress()
    const bits = this.readUint8()
    const width = address.byteLength === 4 ? 32 : 128
    if (bits > width) throw new Error('Invalid SRS IP prefix')
    this.consumeValue()
    return `${formatIp(bytesToBigInt(address), width)}/${bits}`
  }

  readBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.value.byteLength - this.offset) {
      throw new Error('Unexpected end of SRS data')
    }
    const result = this.value.subarray(this.offset, this.offset + length)
    this.offset += length
    return result
  }

  consumeValue(count = 1): void {
    this.consumedValues += count
    if (this.consumedValues > this.maxValues) throw new Error('SRS value count exceeds the safety limit')
  }

  private readUvarint(label: string): number {
    let value = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = this.readUint8()
      value |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) {
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid ${label}`)
        return Number(value)
      }
    }
    throw new Error(`Invalid ${label}`)
  }
}
