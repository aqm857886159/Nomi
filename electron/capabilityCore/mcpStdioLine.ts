/** Pure stdio JSON-RPC line boundary shared by the Electron server and bare Node launcher. */
export const MAX_MCP_LINE_BYTES = 4 * 1024 * 1024

export type McpStdioLineResult =
  | { kind: 'blank' }
  | { kind: 'oversized'; bytes: number }
  | { kind: 'parse-error' }
  | { kind: 'message'; value: unknown }

export function parseMcpStdioLine(line: string): McpStdioLineResult {
  const trimmed = line.trim()
  if (!trimmed) return { kind: 'blank' }
  const bytes = Buffer.byteLength(trimmed, 'utf8')
  if (bytes > MAX_MCP_LINE_BYTES) return { kind: 'oversized', bytes }
  try {
    return { kind: 'message', value: JSON.parse(trimmed) }
  } catch {
    return { kind: 'parse-error' }
  }
}
