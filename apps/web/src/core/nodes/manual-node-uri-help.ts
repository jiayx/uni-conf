import { URI_SCHEME_TO_PROTOCOL } from '@uni-conf/types'

const URI_SCHEMES = Object.keys(URI_SCHEME_TO_PROTOCOL)

export const MANUAL_NODE_URI_PLACEHOLDER = URI_SCHEMES
  .slice(0, 6)
  .map(scheme => `${scheme}://...`)
  .join(' / ')
