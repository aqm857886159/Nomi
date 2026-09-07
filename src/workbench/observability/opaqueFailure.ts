/**
 * 「错误里什么都没有」时**唯一**允许说的话（错误洗白点的单一 owner，2026-09-07 第二轮）。
 *
 * ── 病根（P2 类根因）──────────────────────────────────────────────────────────────
 * 生成主干道上散着一族一模一样的兜底写法：`error.message ? error.message : '生成失败'`、
 * `evt.message || '文本流式生成失败'`、`error || node.error || 'Generation failed'`。
 * 每一处单看都很无辜，合起来是同一个病：**把「我们不知道发生了什么」印成了一句和顶部状态徽标
 * 一字不差的话**。用户读到的是「生成失败：生成失败」——零信息、零下一步，还挡住了本可展示的线索
 * （错误对象的类名、非 Error 值的原样内容）。2026-09-06 的出站被拦就是这样被洗白掉的：
 * 一条写清楚了「钱没丢、去网络设置确认代理」的错误，一路压成两个字。
 *
 * ── 判据（为什么是这三档）────────────────────────────────────────────────────────
 *  ① 有 message → **原样交出**。message 里可能挂着机器码（`NOMI_ERR::…`）或供应商原话，
 *     下游 classifyGenerationError 全靠它分类；这一档一个字都不许改。
 *  ② Error 但 message 为空 → 交出**类名**（`OutboundDestinationRefusedError` 这种名字本身就是线索）
 *     + 一句诚实的兜底：这是 Nomi 这侧的缺口，请反馈。
 *  ③ 根本不是 Error（`throw {}` / `throw 'x'` / reject(undefined)）→ 交出**能读的那部分**再加同一句。
 *
 * 兜底句走 i18n（R15），且**刻意不等于**顶部徽标的「生成失败」——它必须说出「这是我们的缺口、
 * 你能做的是反馈」，否则又是一次同义反复。
 */
import i18n from '../../i18n'

/** 非 Error 值里能读出来的那部分（对象取 JSON 摘要，其余取字符串），截断防撑爆错误卡。 */
function readableNonError(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const json = JSON.stringify(value)
    return json && json !== '{}' ? json.slice(0, 200) : ''
  } catch {
    return ''
  }
}

/**
 * 任何「要把 unknown 变成一句存进 node.error 的话」的地方都调它，**不许再写自己的字面量兜底**
 * （`scripts/check-outbound-policy.mjs` 规则 4 是这条纪律的机器判据，硬零）。
 */
export function describeOpaqueFailure(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  const fallback = i18n.t('generationCommon.observability.error.opaque.detail')
  if (error instanceof Error) {
    const name = error.name && error.name !== 'Error' ? error.name : ''
    return name ? `${name}: ${fallback}` : fallback
  }
  const readable = readableNonError(error)
  return readable ? `${readable} — ${fallback}` : fallback
}
