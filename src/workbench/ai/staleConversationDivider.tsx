// 「新会话」分隔线(harness S1b):气泡有历史而 LLM 记忆为空时,在历史末尾画一条
// 诚实声明——防"假透明"(用户以为 AI 记得,基于此下指令,产出错钱白花)。
// 不变量(总方案 §5):UI 呈现的"AI 记得的范围"⊆ LLM 实际范围,宁少不多。
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'

export function StaleConversationDivider() {
  const { t } = useTranslation()
  return (
    <div className={cn('flex w-full items-center gap-2 py-1')} role="separator">
      <span className={cn('h-px flex-1 bg-nomi-ink-10')} />
      <span className={cn('shrink-0 text-micro text-nomi-ink-40')}>{t('creationAi.conversationHistory.stale')}</span>
      <span className={cn('h-px flex-1 bg-nomi-ink-10')} />
    </div>
  )
}
