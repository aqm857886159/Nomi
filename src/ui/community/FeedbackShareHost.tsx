import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { DecisionBar, DesignModal } from '../../design'
import { FeedbackReportCard } from './FeedbackReportCard'
import type { FeedbackOpenRequest } from './feedbackTypes'

/**
 * 四个失败面共用的那一个反馈宿主。全局只挂一个（`NomiStudioApp`）。
 *
 * 2026-09-15 改：从失败面进来时**只呈现那张卡本身** —— 没有设置侧栏、没有「反馈与分享」
 * 标题、没有「返回」。
 *
 * 为什么（用户 09-15 看截图时点出来的）：样张 B 里这张卡是**贴着失败面**出现的，
 * 而之前这条路走的是「DesignModal 标题写着反馈与分享 + FeedbackShareContent 的分页外壳」，
 * 用户会以为自己从画布跑进了设置。他此刻要做的只有一件事——发不发——多一层壳就多一次
 * 「我现在在哪」的判断。
 *
 * 设置 → 关于那条路**不走这里**：它把 `FeedbackShareContent` 直接内嵌进设置弹窗右栏
 * （`AboutSection`），那是 2026-09-01 的获批样张形态，一行没动。
 * 所以「同一个 host」指的是同一份卡 + 同一条 IPC，不是同一层外壳。
 */
export function FeedbackShareHost(): JSX.Element {
  const { t } = useTranslation()
  const [request, setRequest] = React.useState<FeedbackOpenRequest | null>(null)
  // 上一张卡「留一会儿再收」的定时器，不许把这会儿新打开的卡关掉。
  const closeTimer = React.useRef<number | undefined>(undefined)

  React.useEffect(() => {
    const handleOpen = (event: Event): void => {
      window.clearTimeout(closeTimer.current)
      const detail = (event as CustomEvent<FeedbackOpenRequest>).detail
      setRequest(detail && typeof detail === 'object' ? detail : {})
    }
    window.addEventListener('nomi-open-feedback-share', handleOpen)
    return () => {
      window.clearTimeout(closeTimer.current)
      window.removeEventListener('nomi-open-feedback-share', handleOpen)
    }
  }, [])

  if (!request) return <></>
  const close = (): void => setRequest(null)
  return (
    // 发完（拿到编号或入队）就关窗 —— 他已经拿到回执，这张卡没有别的用途。
    // 留一会儿让他看见那行回执再收，多久由卡决定（一句话比一个编号要读得久）。
    <FeedbackReportCard
      request={request}
      showHeading={false}
      onDone={(lingerMs) => { closeTimer.current = window.setTimeout(close, lingerMs) }}
      // 卡的内容进弹窗中间那块（清单再长也只在那里滚），「发送」进弹窗的决定栏：
      // 最小窗口 + 英文 + 清单展开时也完整可见（设计系统 §3.5，夜跑 #076）。
      frame={({ card, send }) => (
        <DesignModal
          opened
          onClose={close}
          centered
          size="md"
          // 标题归 modal 的标题栏，卡上那行 h2 就关掉（`showHeading={false}`）。
          // 两个都留会在卡上方留出一条空白带，而「空白=冗余」是拍板过的规则。
          title={t('feedbackReport.title')}
          padding="lg"
          closeOnClickOutside
          // 清单是卡里唯一会缩的那段（卡根 min-h-0、清单 min-h-0 overflow-y-auto），留言框和说明行一直看得见。
          innerScroll
          actions={send ? (
            <DecisionBar
              cancelLabel={t('common.cancel')}
              onCancel={close}
              primaryLabel={send.label}
              onPrimary={send.onSend}
              primaryDisabled={send.disabled}
              primaryHint={send.hint}
              primaryProps={{ 'data-feedback-send': '' }}
            />
          ) : undefined}
        >
          {card}
        </DesignModal>
      )}
    />
  )
}
