export const GEOIP_MMDB_URL = 'https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/Country-without-asn.mmdb'
export const ASN_MMDB_URL = 'https://cdn.jsdelivr.net/gh/Loyalsoldier/geoip@release/GeoLite2-ASN.mmdb'

// Keep system-proxy exclusions focused on loopback and private/local destinations.
export const LOCAL_PROXY_BYPASS_ENTRIES = [
  'localhost',
  '*.local',
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
]

// Keep local, link-local and multicast traffic reachable outside the virtual interface.
export const TUN_EXCLUDED_ROUTE_ENTRIES = [
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '224.0.0.0/4',
  '255.255.255.255/32',
]
