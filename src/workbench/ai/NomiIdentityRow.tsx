import type { JSX } from 'react'
// Nomi 身份行的「单一渲染真相源」（P1）：以 Nomi 身份发言的卡片共用这一行，
// 保证脸 + 文字规则不在各处漂。
import { NomiAgentFace, NomiWordmark } from '../../design'
import { cn } from '../../utils/cn'

/** 一行轻身份：Agent 形象的静态脸（与右下小球同一个角色、同一套几何；不动、不眨眼、不带状态）+ 「Nomi」名。
 *  拍板 docs/design/boards/2026-10-27-agent-persona/AgentIdentityRow.board.json。
 *  export 供恢复卡等同样「以 Nomi 身份发言」的组件复用（统一脸+文字规则，单一真相源 P1）。 */
export function NomiIdentityRow(): JSX.Element {
  return (
    <div className={cn('flex items-center gap-1.5 mb-1')} data-assistant-identity="true">
      <NomiAgentFace variant="mark" size={16} />
      <NomiWordmark fontSize={12} className="text-nomi-ink-60" />
    </div>
  )
}
