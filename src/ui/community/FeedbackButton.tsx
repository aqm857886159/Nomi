import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { FeedbackOpenRequest } from './feedbackTypes'
import { openFeedbackFor } from './feedbackEvents'

// 四个失败面上那**同一颗**「反馈」钮。
//
// 为什么做成一个组件而不是各面自己写一个 onClick：那颗钮的职责不是「打开一个弹层」，
// 而是「把这个失败面知道的上下文交给反馈面」。上下文的字段集（summary / surface /
// errorKind / provider / model / laneName）会继续长，各面各写一份就会长得不一样——
// 而长得不一样的那几处，正是「反馈里没带轨迹」这类问题后来最难查的地方。
//
// 走的是**既有**通道 `nomi-open-feedback-share`（2026-09-01 起就一个全局 host，
// `src/ui/community/FeedbackShareHost.tsx`），不新开第二个 dialog host。
export function FeedbackButton({
  request,
  className,
}: {
  request: FeedbackOpenRequest
  className?: string
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-feedback-open
      onClick={(event) => {
        event.stopPropagation()
        openFeedbackFor(request)
      }}
      className={className ?? 'shrink-0 whitespace-nowrap border-0 bg-transparent px-0 text-caption text-nomi-ink-40 hover:text-nomi-ink'}
    >
      {t('generationCommon.error.feedback')}
    </button>
  )
}
