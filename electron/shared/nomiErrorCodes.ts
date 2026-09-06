// Nomi 自有错误的**机器可读码**（electron-free：主进程 throw、渲染层 classify 都要引，且要能被
// 打包后的裸 Node MCP launcher require，故零 electron/node 顶层导入）。
//
// 为什么要它（root-cause，替换「按中文文案子串分类」那一族）：
//   主进程某处 throw 一句中文人话（如「素材超过所有上传通道的大小上限」），渲染层 classifyError 靠
//   对这句人话做子串匹配把它归成 asset-too-large。两端用**同一句中文人话**当协议——那句一旦被
//   i18n 化 / 改词，分类当场断，而单测多半还绿（喂的就是写死的中文）。典型的「本地看不出、线上换语言才炸」。
//
// 解法与 vendorHttp.ts 的 VENDOR_ERROR_IPC_MARKER 同构：在 message 里嵌一段**稳定的码标记**，
// 它不随人话翻译而变。throw 端 tagNomiError(code, humanMessage) 前缀标记；classify 端
// matchNomiErrorCode(raw) 只认码；展示端 stripNomiErrorCode(raw) 把标记剥掉、只留人话。
// 标记走 message 字符串，因此能穿透 Electron IPC 的 rejection（和 vendor marker 一样，IPC 只剩 message）。

/** 目前纳入码化的自有错误类别。新增一类时在这里加一个稳定字符串常量，别在别处硬编码字面量。 */
export type NomiErrorCode =
  | 'asset-too-large' // 素材超过所有上传通道的体积上限（HTTP 413 全挂）——确定性失败，得压缩不能重试
  | 'asset-upload-failed' // 所有上传通道都没成功（非 413）——失败在我们这侧，服务商没被请求到
  // Nomi **自己的**出站安全策略拒绝了这次取片（私网/回环/fake-ip 未确证）。与上面两条同族：
  // 失败在我们这侧、服务商根本没被请求到。但它还多一件事——任务**已经付过钱**且上游多半已完成，
  // 所以正确的下一步是「修网络再免费重新拉取」，绝不是「重新生成」（那要再付一次）。
  | 'outbound-blocked'

const MARKER_PREFIX = 'NOMI_ERR::'
const MARKER_SUFFIX = '::'
// 码只用 [a-z-]，标记形如 `NOMI_ERR::asset-too-large:: <人话>`；正则据此从任意位置抠出码。
const MARKER_RE = /NOMI_ERR::([a-z-]+)::/

/** throw 端：给人话消息前缀一段稳定码标记。返回的字符串照旧可读（标记在最前，人话紧随）。 */
export function tagNomiError(code: NomiErrorCode, humanMessage: string): string {
  return `${MARKER_PREFIX}${code}${MARKER_SUFFIX} ${humanMessage}`
}

/** classify 端：从 message 里解出 Nomi 错误码；没有标记 → null（走 legacy 兜底）。 */
export function matchNomiErrorCode(message: string): NomiErrorCode | null {
  const m = MARKER_RE.exec(String(message || ''))
  return m ? (m[1] as NomiErrorCode) : null
}

/** 展示端：剥掉码标记，只留人话（技术详情里的 raw 若要保留原样则不调它）。 */
export function stripNomiErrorCode(message: string): string {
  const text = String(message || '')
  const m = MARKER_RE.exec(text)
  if (!m) return text
  return (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()
}
