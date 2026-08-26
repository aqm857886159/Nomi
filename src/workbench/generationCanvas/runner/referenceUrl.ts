// 参考 URL 解析的**唯一**底层助手：从节点 result 取可用 URL、按白名单校验、按 `nodeId[:resultId]`
// 引用定位。generationReferenceResolver（生成期）与 referenceSlots（能力驱动槽解析）共用这一份，
// 不再各写一套（P1 单一真相源）。
import { isLocalizableAssetValue } from '../../../../electron/catalog/assetValueScheme'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

/**
 * 参考 URL 白名单：放行「能喂给 vendor（http/https）」或「主进程能物化成公网 URL」的形态，
 * 其余（自定义 scheme、空串）视为无 URL。
 *
 * **可本地化的那一档不在这里手列**，直接问 assetValueScheme（与出站侧同一个判定器，P1 单一真相）：
 * 今天是 `nomi-local://`（抽帧 IPC 的返回值、导入落盘的素材）+ `data:` 内联字节；以后加一种形态，
 * 出站能处理的当天这里就自动认，不会再出现「主进程收得下、渲染层先把它丢了」的裂缝。
 *
 * `data:` 从「被丢掉」改成放行，修的是一条静默丢参考（2026-08-26）：卡片上传/切图/导入在**落盘
 * 失败**时会把 base64 留在 node.result.url（兜底：可持久化、不丢图，见 persistNodeImage）。这类
 * 节点连线当参考时 URL 在此判空 → 参考被悄悄丢掉 → 要么 L3 报「你没连参考」（把原因说反了），
 * 要么按纯文生跑照样扣费。主进程现在会把内联字节物化上传（assetLocalization），这里没有再拦的理由。
 *
 * `blob:` 继续放行是**有意的**：本函数同时喂参考 chip 的显示（referenceSlots 的 fill.url），
 * 而 blob: 正是「还没落盘的即时预览」那一档，拦了它 chip 就空着。它到不了 vendor 也不会静默上路——
 * 主进程在付费守卫前拒发并说清原因（assetValueScheme 判 unreachable）。
 * 裸 `/` 开头曾一并放行，此处删掉：它既不是可达 URL（发给 vendor 必错），也只有开发态的 Vite
 * 根路径下才显示得出来（打包后渲染层不从 http 根提供服务），全仓扫不到任何生产者。
 */
export function asUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (/^https?:\/\//i.test(trimmed) || isLocalizableAssetValue(trimmed)) return trimmed
  return trimmed.startsWith('blob:') ? trimmed : ''
}

/** 从一条 result 取可用 URL：**优先本地持久文件**（nomi-local://）——chip 预览永不腐烂；发送前由
 *  localizeAssetsForVendor 换成 vendor 可达值（sidecar originalUrl 新鲜则零成本直用，过期则用本地字节
 *  重新上传换新链）。providerUrl 只在无本地拷贝时兜底（#4「providerUrl-only 被生成侧丢」仍覆盖）。
 *  旧口径 providerUrl 优先，是「过期临时链发给服务商→报错/无视原图 + chip 加载失败」整类问题的根因
 *  （2026-07-06 根治，docs/plan/2026-07-06-i2i-reference-reliability.md L2）。 */
export function resultUrl(result: GenerationNodeResult | undefined): string {
  return asUrl(result?.url) || asUrl(result?.providerUrl) || asUrl(result?.thumbnailUrl)
}

/** 按 `nodeId` 或 `nodeId:resultId` 引用定位一条 result 的 URL；定位不到 → ''。 */
export function findNodeResultUrl(nodesById: Map<string, GenerationCanvasNode>, reference: string): string {
  const [nodeId, resultId] = reference.split(':')
  const node = nodesById.get(nodeId)
  if (!node) return ''
  if (resultId) {
    const result = node.history?.find((entry) => entry.id === resultId)
    return resultUrl(result)
  }
  return resultUrl(node.result) || resultUrl(node.history?.[0])
}

/** 把一个「可能是直接 URL、可能是节点引用」的值解析成 URL。 */
export function resolveReferenceUrl(nodesById: Map<string, GenerationCanvasNode>, reference: unknown): string {
  const directUrl = asUrl(reference)
  if (directUrl) return directUrl
  if (typeof reference !== 'string') return ''
  return findNodeResultUrl(nodesById, reference)
}
