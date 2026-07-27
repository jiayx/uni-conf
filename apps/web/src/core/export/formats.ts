import { EXPORT_SUBSCRIPTION_FORMATS } from '@uni-conf/shared'
import type { ExportFormat } from '@uni-conf/types'

const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  mihomo: 'Mihomo YAML',
  clash: 'Clash YAML',
  singbox: 'sing-box JSON',
  loon: 'Loon CONF',
  surge: 'Surge CONF',
  shadowrocket: 'Shadowrocket CONF',
  quantumultx: 'Quantumult X CONF',
  stash: 'Stash YAML',
  egern: 'Egern YAML',
  nodes_base64: 'Node Subscription (Base64)',
  nodes_raw: 'Node Subscription (Raw)',
}

export const EXPORT_FORMAT_OPTIONS = EXPORT_SUBSCRIPTION_FORMATS.map(value => ({
  value,
  label: EXPORT_FORMAT_LABELS[value],
}))

export const PREVIEW_FORMATS: ExportFormat[] = EXPORT_FORMAT_OPTIONS.map(option => option.value)

export const QUICK_EXPORT_OPTIONS = EXPORT_FORMAT_OPTIONS
