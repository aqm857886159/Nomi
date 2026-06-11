// VendorRequestError.structured 的渲染层解析(harness S4-2)。
// 与 electron/vendor/vendorHttp.ts 的 VENDOR_ERROR_IPC_MARKER 配对——双端常量,
// 改一处必改另一处(IPC rejection 只剩 message 字符串,structured 以 base64 嵌入穿透)。
const MARKER = 'NOMI_VENDOR_ERR_B64::'

export type VendorErrorStructuredLite = {
  vendorKey?: string
  httpStatus?: number
  logicalCode?: number | string
  upstreamMsg?: string
  category?: string
  retryable?: boolean
}

/** 从错误 message 中解出 structured;没有标记/解析失败 → null(走 legacy 正则兜底)。 */
export function parseVendorErrorFromMessage(message: string): VendorErrorStructuredLite | null {
  const text = String(message || '')
  const start = text.indexOf(MARKER)
  if (start < 0) return null
  const rest = text.slice(start + MARKER.length)
  const end = rest.indexOf('::')
  if (end < 0) return null
  try {
    // base64 → UTF-8(upstreamMsg 可能是中文,atob 直接产 Latin-1 二进制串,需 TextDecoder)
    const binary = atob(rest.slice(0, end))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as VendorErrorStructuredLite
  } catch {
    return null
  }
}

/** 展示用:把 message 里的标记段剥掉,只留人读得懂的部分。 */
export function stripVendorErrorMarker(message: string): string {
  const text = String(message || '')
  const start = text.indexOf(MARKER)
  if (start < 0) return text
  const rest = text.slice(start + MARKER.length)
  const end = rest.indexOf(':: ')
  if (end < 0) return text.slice(0, start).trim() || text
  return (text.slice(0, start) + rest.slice(end + 3)).trim()
}
