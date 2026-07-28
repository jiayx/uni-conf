import { Decompress } from 'fzstd'

export type MihomoMrsBehavior = 'domain' | 'ipcidr'

export interface MihomoMrsResult {
  behavior: MihomoMrsBehavior
  declaredRuleCount: number
  rules: string[]
}

const MRS_MAGIC = [0x4d, 0x52, 0x53, 0x01]
const DOMAIN_SET_VERSION = 1
const IP_SET_VERSION = 1
const DEFAULT_MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_RULES = 1_000_000
const IPV4_MAPPED_PREFIX = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff])
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

export function isMihomoMrs(input: Uint8Array): boolean {
  return input.byteLength >= ZSTD_MAGIC.length
    && ZSTD_MAGIC.every((byte, index) => input[index] === byte)
}

export function parseMihomoMrs(
  compressed: Uint8Array,
  options: {
    expectedBehavior?: MihomoMrsBehavior
    maxDecompressedBytes?: number
    maxRules?: number
  } = {},
): MihomoMrsResult {
  const bytes = decompressLimited(
    compressed,
    options.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES,
  )
  const reader = new BinaryReader(bytes)
  for (const expected of MRS_MAGIC) {
    if (reader.readUint8() !== expected) throw new Error('Invalid MRS magic or version')
  }

  const behaviorByte = reader.readUint8()
  const behavior = behaviorByte === 0 ? 'domain' : behaviorByte === 1 ? 'ipcidr' : null
  if (!behavior) throw new Error('MRS only supports domain and ipcidr behaviors')
  if (options.expectedBehavior && behavior !== options.expectedBehavior) {
    throw new Error(`MRS behavior is ${behavior}, expected ${options.expectedBehavior}`)
  }

  const declaredRuleCount = reader.readLength('rule count')
  if (declaredRuleCount > (options.maxRules ?? DEFAULT_MAX_RULES)) {
    throw new Error('MRS rule count exceeds the safety limit')
  }
  reader.skip(reader.readLength('reserved data length'))

  const rules = behavior === 'domain'
    ? readDomainRules(reader, options.maxRules ?? DEFAULT_MAX_RULES)
    : readIpCidrRules(reader, options.maxRules ?? DEFAULT_MAX_RULES)
  if (!reader.done) throw new Error('MRS contains trailing data')
  return { behavior, declaredRuleCount, rules }
}

function decompressLimited(compressed: Uint8Array, maxBytes: number): Uint8Array {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid decompressed size limit')
  const chunks: Uint8Array[] = []
  let total = 0
  let completed = false
  const decompressor = new Decompress((chunk, final) => {
    total += chunk.byteLength
    if (total > maxBytes) throw new Error('Decompressed MRS exceeds the safety limit')
    chunks.push(chunk)
    completed ||= Boolean(final)
  })
  decompressor.push(compressed, true)
  if (!completed) throw new Error('Incomplete MRS Zstandard stream')

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function readDomainRules(reader: BinaryReader, maxRules: number): string[] {
  if (reader.readUint8() !== DOMAIN_SET_VERSION) throw new Error('Unsupported MRS domain-set version')
  const leaves = reader.readUint64Words('domain leaves')
  const labelBitmap = reader.readUint64Words('domain label bitmap')
  const labels = reader.readBytes(reader.readLength('domain labels length'))
  if (labels.byteLength > maxRules * 256) throw new Error('MRS domain trie exceeds the safety limit')

  const children: Array<Array<{ label: number; nodeId: number }>> = []
  let bitmapIndex = 0
  let labelIndex = 0
  let nextNodeId = 1
  for (let nodeId = 0; nodeId < nextNodeId; nodeId += 1) {
    const nodeChildren: Array<{ label: number; nodeId: number }> = []
    while (!getWordBit(labelBitmap, bitmapIndex)) {
      if (labelIndex >= labels.byteLength) throw new Error('Invalid MRS domain trie labels')
      nodeChildren.push({ label: labels[labelIndex]!, nodeId: nextNodeId })
      labelIndex += 1
      nextNodeId += 1
      bitmapIndex += 1
    }
    bitmapIndex += 1
    children.push(nodeChildren)
    if (nextNodeId > maxRules * 256 + 1) throw new Error('MRS domain trie exceeds the safety limit')
  }
  if (labelIndex !== labels.byteLength) throw new Error('Invalid MRS domain trie bitmap')

  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  const rawRules: string[] = []
  const path: number[] = []
  const visit = (nodeId: number): void => {
    if (getWordBit(leaves, nodeId)) {
      const reversed = Uint8Array.from(path).reverse()
      rawRules.push(decoder.decode(reversed))
      if (rawRules.length > maxRules) throw new Error('MRS rule count exceeds the safety limit')
    }
    for (const child of children[nodeId] ?? []) {
      path.push(child.label)
      visit(child.nodeId)
      path.pop()
    }
  }
  visit(0)

  rawRules.sort()
  const ruleSet = new Set(rawRules)
  return rawRules.filter(rule => !ruleSet.has(`+.${rule}`))
}

function readIpCidrRules(reader: BinaryReader, maxRules: number): string[] {
  if (reader.readUint8() !== IP_SET_VERSION) throw new Error('Unsupported MRS IP-set version')
  const rangeCount = reader.readLength('IP range count')
  if (rangeCount > maxRules) throw new Error('MRS IP range count exceeds the safety limit')
  const rules: string[] = []
  for (let index = 0; index < rangeCount; index += 1) {
    const startBytes = reader.readBytes(16)
    const endBytes = reader.readBytes(16)
    const startIsIpv4 = hasPrefix(startBytes, IPV4_MAPPED_PREFIX)
    const endIsIpv4 = hasPrefix(endBytes, IPV4_MAPPED_PREFIX)
    if (startIsIpv4 !== endIsIpv4) throw new Error('Invalid mixed-family MRS IP range')
    const ipv4 = startIsIpv4
    const start = bytesToBigInt(startBytes.subarray(ipv4 ? 12 : 0))
    const end = bytesToBigInt(endBytes.subarray(ipv4 ? 12 : 0))
    if (start > end) throw new Error('Invalid MRS IP range')
    rules.push(...rangeToCidrs(start, end, ipv4 ? 32 : 128))
    if (rules.length > maxRules) throw new Error('MRS rule count exceeds the safety limit')
  }
  return rules
}

function rangeToCidrs(startValue: bigint, end: bigint, width: 32 | 128): string[] {
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

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

function hasPrefix(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte)
}

function getWordBit(words: Uint8Array, bitIndex: number): boolean {
  const wordIndex = Math.floor(bitIndex / 64)
  const bitInWord = bitIndex % 64
  const byteIndex = wordIndex * 8 + 7 - Math.floor(bitInWord / 8)
  if (byteIndex >= words.byteLength) throw new Error('Invalid MRS bitmap')
  return (words[byteIndex]! & (1 << (bitInWord % 8))) !== 0
}

class BinaryReader {
  private offset = 0
  private readonly value: Uint8Array

  constructor(value: Uint8Array) {
    this.value = value
  }

  get done(): boolean {
    return this.offset === this.value.byteLength
  }

  readUint8(): number {
    this.ensureAvailable(1)
    return this.value[this.offset++]!
  }

  readLength(label: string): number {
    const value = this.readUint64()
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid ${label}`)
    return Number(value)
  }

  readBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid MRS length')
    this.ensureAvailable(length)
    const result = this.value.subarray(this.offset, this.offset + length)
    this.offset += length
    return result
  }

  readUint64Words(label: string): Uint8Array {
    const count = this.readLength(`${label} length`)
    if (count > Math.floor((this.value.byteLength - this.offset) / 8)) throw new Error(`Invalid ${label}`)
    return this.readBytes(count * 8)
  }

  skip(length: number): void {
    this.readBytes(length)
  }

  private readUint64(): bigint {
    const bytes = this.readBytes(8)
    return bytesToBigInt(bytes)
  }

  private ensureAvailable(length: number): void {
    if (length > this.value.byteLength - this.offset) throw new Error('Unexpected end of MRS data')
  }
}
