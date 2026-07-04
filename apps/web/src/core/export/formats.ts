import type { ExportFormat } from '@uni-conf/types'

export const EXPORT_FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'mihomo', label: 'Mihomo / Clash / OpenClash YAML' },
  { value: 'singbox', label: 'sing-box JSON' },
  { value: 'loon', label: 'Loon CONF' },
  { value: 'surge', label: 'Surge CONF' },
  { value: 'shadowrocket', label: 'Shadowrocket CONF' },
  { value: 'quantumultx', label: 'Quantumult X CONF' },
  { value: 'stash', label: 'Stash YAML' },
  { value: 'egern', label: 'Egern YAML' },
  { value: 'nodes_base64', label: 'Node Subscription (Base64)' },
  { value: 'nodes_raw', label: 'Node Subscription (Raw)' },
]

export const PREVIEW_FORMATS: ExportFormat[] = EXPORT_FORMAT_OPTIONS.map(option => option.value)

export const QUICK_EXPORT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'mihomo', label: 'Mihomo / Clash / OpenClash YAML' },
  { value: 'singbox', label: 'sing-box JSON' },
  { value: 'loon', label: 'Loon CONF' },
  { value: 'surge', label: 'Surge CONF' },
  { value: 'shadowrocket', label: 'Shadowrocket CONF' },
  { value: 'quantumultx', label: 'Quantumult X CONF' },
  { value: 'stash', label: 'Stash YAML' },
  { value: 'egern', label: 'Egern YAML' },
  { value: 'nodes_base64', label: 'Node Subscription (Base64)' },
  { value: 'nodes_raw', label: 'Node Subscription (Raw)' },
]
