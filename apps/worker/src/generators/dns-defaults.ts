export const MAINLAND_DNS_BOOTSTRAP = ['223.5.5.5', '119.29.29.29'] as const

export const MAINLAND_DOH_SERVERS = [
  'https://223.5.5.5/dns-query',
  'https://223.6.6.6/dns-query',
  'https://doh.pub/dns-query',
] as const

export const OVERSEAS_DOH_SERVERS = [
  'https://1.1.1.1/dns-query',
  'https://8.8.8.8/dns-query',
] as const
