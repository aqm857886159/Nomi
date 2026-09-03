/**
 * 常驻壳 ←→ 分镜表的桥：把一次待确认的 `patch_shots` 调用送去行内做就地预览，
 * 并在它被采用/丢弃/异常收尾时收回预览。
 *
 * 从 `ProjectAgentResidentShell` 抽出来：那个壳负责「把一轮对话跑起来」，
 * 不该顺带承载「分镜表怎么显示待确认改动」这条领域规则（R9；它已顶到 800 行硬上限）。
 * 同一手法在本轮用过两次——`documentSurfaceHandlers`（取数规则）、`nodeModelHealth`（记账规则）。
 */
import { clearStoryboardPatchPreview, publishStoryboardPatchPreview } from '../../creation/storyboard/storyboardPatchPreview'

/** 只有这个工具会在分镜行内就地预览；其余工具走常驻面板的确认卡。 */
export function isStoryboardPatchTool(toolName: string): boolean {
  return toolName.toLowerCase() === 'patch_shots'
}

/**
 * 送一次待确认改动去行内预览。
 *
 * `onApprove` / `onDiscard` 由壳提供——**决定权仍归壳的审批管线**，这里只负责
 * 「显示出来、并在结束时收回」。收回放在 `finally` 里：无论采用、丢弃还是抛错，
 * 预览都必须消失，否则表上会留一条永远等不到结果的幽灵改动。
 */
export function presentStoryboardPatchPreview(input: Readonly<{
  key: string
  args: Record<string, unknown>
  approve: () => Promise<unknown>
  discard: () => Promise<unknown>
}>): void {
  publishStoryboardPatchPreview({
    id: input.key,
    args: input.args,
    onApprove: () => { void input.approve().finally(() => clearStoryboardPatchPreview(input.key)) },
    onDiscard: () => { void input.discard().finally(() => clearStoryboardPatchPreview(input.key)) },
  })
}

/** 工具轮结束时收回预览（壳的 finally 里调；非 patch_shots 调用是无操作）。 */
export function dismissStoryboardPatchPreview(toolName: string, key: string): void {
  if (isStoryboardPatchTool(toolName)) clearStoryboardPatchPreview(key)
}
