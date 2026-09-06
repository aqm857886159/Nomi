// Agent 面板 v4 · 对话流的**折叠层**：把一段「反复试」压成两行。
//
// 为什么需要这一层（2026-09-06 打包版真实使用抓到）：
// 用户让 Agent「从原稿重拆 10 镜」，右侧面板出现 **6 条一模一样**的
// 「创建或修改镜头卡 · 只建卡·不生成 · ⚠ <1s」，中间夹着模型的自言自语
// （「我看到参数需要是数组而不是字符串…」「我把 JSON 字符串化两次了…」）。
// 用户原话：「这堆工具没什么重要的东西……不可能有这么多都放在那里……看的时候得点入」。
//
// 平铺的代价不是难看，是**读不出结构**：六条同名收据看起来像六件事，
// 而它其实是同一件事失败了六次；夹在中间的过程文本是模型在跟自己说话，
// 不是给用户的回答，却和最终回答长得一模一样、一样占满宽度。
//
// 所以这一层做两件、且只做两件事（Claude Code 的做法）：
//   ③→ 同一个工具连着调 N 次（N≥2）折成一行「创建或修改镜头卡 ×6 · 全部失败 · 原因」，
//       展开才逐次；
//   ②→ 这一段里**不是最终回答**的助手文本折成一条过程行「尝试了 6 次 · 展开」。
//
// 不新增第九个积木：`tool-group` 就是一行收据的容器态，`process` 就是助手文本的收起态。
// 只调了一次的工具、以及最终那条回答，一律原样——折叠只在「重复」出现时才有意义，
// 把一条也折起来只会让用户多点一下。
import type { ToolReceipt, V4FlowItem, V4ToolStatus } from './agentPanelV4Types'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** 一段「工作」的边界：用户气泡、任务卡、介入相关的任何东西都会把它截断。 */
function isWorkItem(item: V4FlowItem): boolean {
  return item.kind === 'tool' || item.kind === 'assistant'
}

function groupKey(receipt: ToolReceipt): string {
  // 分隔符用转义的 U+0000：标签是人话，任何可见字符都可能出现在里面，撞了就会把两个不同的工具
  // 当成同一组折起来。裸 NUL 会让整个文件对 grep/git 变成二进制（`check:nul-bytes`），所以写转义。
  return `${receipt.action}\u0000${receipt.label}`
}

/**
 * 一组同名收据 → 一行。
 *
 * `status` 取「这一组最后落在哪个态」，但**全失败**是一个独立的说法：
 * 六条里五条失败一条成功，和六条全失败，对用户是两件事。
 */
function toolGroupFor(receipts: readonly ToolReceipt[], t: Translate): V4FlowItem {
  const failures = receipts.filter((receipt) => receipt.status === 'output-error')
  const allFailed = failures.length === receipts.length
  const status: V4ToolStatus = allFailed ? 'output-error' : receipts[receipts.length - 1]!.status
  // 原因取**第一条**失败的摘要：后面几次是同一个错的复读，第一条才是模型撞上的那堵墙。
  const reason = failures[0]?.summary
  return {
    kind: 'tool-group',
    label: receipts[0]!.label,
    action: receipts[0]!.action,
    status,
    count: receipts.length,
    trailing: allFailed
      ? t('agentPanelV4.toolGroupAllFailed')
      : failures.length
        ? t('agentPanelV4.toolGroupSomeFailed', { count: failures.length })
        : t('agentPanelV4.toolGroupAllDone'),
    ...(reason ? { reason } : {}),
    receipts,
  }
}

/** 相邻同名的收据切成若干段；只有 ≥2 的那段才折。 */
function emitTools(receipts: readonly ToolReceipt[], t: Translate, out: V4FlowItem[]): void {
  let run: ToolReceipt[] = []
  const flush = (): void => {
    if (!run.length) return
    if (run.length === 1) out.push({ kind: 'tool', receipt: run[0]! })
    else out.push(toolGroupFor(run, t))
    run = []
  }
  for (const receipt of receipts) {
    if (run.length && groupKey(run[0]!) !== groupKey(receipt)) flush()
    run.push(receipt)
  }
  flush()
}

/**
 * 折叠一整条对话流。纯函数：同一份输入永远得到同一份输出，可逐条单测。
 *
 * 一段的判据是「从一条工具收据起，直到出现工具/助手以外的东西为止」，且这一段里
 * **至少有两次工具调用**——只调一次的地方一个字都不动，历史走查与已录基线因此不受影响。
 */
export function collapseV4Flow(flow: readonly V4FlowItem[], t: Translate): readonly V4FlowItem[] {
  const out: V4FlowItem[] = []
  let index = 0
  while (index < flow.length) {
    const item = flow[index]!
    if (item.kind !== 'tool') {
      out.push(item)
      index += 1
      continue
    }
    let end = index
    while (end < flow.length && isWorkItem(flow[end]!)) end += 1
    const stretch = flow.slice(index, end)
    const toolCount = stretch.filter((entry) => entry.kind === 'tool').length
    if (toolCount < 2) {
      out.push(item)
      index += 1
      continue
    }
    let lastToolAt = -1
    stretch.forEach((entry, at) => {
      if (entry.kind === 'tool') lastToolAt = at
    })
    const receipts = stretch.filter((entry): entry is Extract<V4FlowItem, { kind: 'tool' }> => entry.kind === 'tool')
      .map((entry) => entry.receipt)
    // 「最终回答」= 最后一次工具调用**之后**还说的话。之前说的每一句都是过程——
    // 模型在读报错、在自我纠正，那不是给用户的答案。
    const intermediate = stretch
      .slice(0, lastToolAt)
      .filter((entry): entry is Extract<V4FlowItem, { kind: 'assistant' }> => entry.kind === 'assistant')
      .map((entry) => entry.text)
    emitTools(receipts, t, out)
    if (intermediate.length) {
      out.push({
        kind: 'process',
        label: t('agentPanelV4.processAttempts', { count: toolCount }),
        segments: Object.freeze(intermediate),
      })
    }
    for (const trailing of stretch.slice(lastToolAt + 1)) out.push(trailing)
    index = end
  }
  return Object.freeze(out)
}
