import { EXPORT_SUBSCRIPTION_FORMATS } from '@uni-conf/shared'
import type { ExportFormat } from '@uni-conf/types'

export const EXPORT_FORMAT_NAMES: Record<ExportFormat, string> = {
  mihomo: 'Mihomo / Clash.Meta',
  singbox: 'sing-box',
  loon: 'Loon',
  surge: 'Surge',
  shadowrocket: 'Shadowrocket',
  quantumultx: 'Quantumult X',
  stash: 'Stash',
  egern: 'Egern',
  nodes_base64: 'Node Subscription (Base64)',
  nodes_raw: 'Node Subscription (Raw)',
}

const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  mihomo: 'Mihomo / Clash.Meta YAML',
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
