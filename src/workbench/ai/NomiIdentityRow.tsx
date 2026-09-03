// Nomi 身份行的「单一渲染真相源」（P1）：以 Nomi 身份发言的卡片共用这一行，
// 保证 logo + 文字规则不在各处漂。
import { NomiLogoMark, NomiWordmark } from '../../design'
import { cn } from '../../utils/cn'

/** 一行轻身份：真 brand logo mark + 「Nomi」名。
 *  export 供恢复卡等同样「以 Nomi 身份发言」的组件复用（统一 logo+文字规则，单一真相源 P1）。 */
export function NomiIdentityRow(): JSX.Element {
  return (
    <div className={cn('flex items-center gap-1.5 mb-1')} data-assistant-identity="true">
      <NomiLogoMark size={16} />
      <NomiWordmark fontSize={12} className="text-nomi-ink-60" />
    </div>
  )
}
