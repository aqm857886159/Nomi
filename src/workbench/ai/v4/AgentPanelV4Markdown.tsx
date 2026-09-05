// Agent 面板 v4 · 助手文本的 Markdown 档（沿用 `NomiMarkdown`，不重造）
//
// 定稿 Rendering 板定的是「390 宽面板里的**显示决定**」，不是另一套解析器：
// 标题降粗体行、代码块加复制并折叠、外链带 ↗、图片不内联渲（走任务卡）、超长折 60%、
// 流式不预测闭合、不做数学 / mermaid。这些住在 `NomiMarkdown` 的 `profile="agent-v4"` 里。
//
// 这里只管**超长折叠**那一条，而且折的高度是 derive 的：定稿写的是「超过面板高度 60% 的
// 单条助手文本默认折到 60% 高」——首版写死 `max-h-60`（Tailwind 的 15rem = 240px），
// 于是 640 高的面板里一张三行表格就被腰斩，尾巴上那句「还有 N 行」也算不出 N。
import React from 'react'
import { IconChevronDown } from './AgentPanelV4Icons'
import { NomiMarkdown } from '../../common/NomiMarkdown'
import { useTranslation } from 'react-i18next'

/** 折叠阈值 = 面板高 × 60%（定稿 Rendering 板）。没给面板高就不折——宁可长，不可骗。 */
const foldHeightFor = (panelHeight?: number): number | undefined =>
  panelHeight ? Math.round(panelHeight * 0.6) : undefined

export function AgentPanelV4Markdown({
  text,
  panelHeight,
  streaming = false,
}: {
  text: string
  panelHeight?: number
  /** 流式时不折——用户正在读它（定稿：流完才折）。 */
  streaming?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const [overflowRows, setOverflowRows] = React.useState(0)
  const fold = streaming ? undefined : foldHeightFor(panelHeight)

  // 「还有 N 行」的 N 只能量出来：Markdown 渲染后的行数不等于源文本的换行数
  // （表格、列表、代码块各占几行由排版决定）。量一次，内容或折高变了再量。
  React.useEffect(() => {
    const node = bodyRef.current
    if (!node || !fold) { setOverflowRows(0); return }
    const lineHeight = 20
    setOverflowRows(Math.max(0, Math.ceil((node.scrollHeight - fold) / lineHeight)))
  }, [text, fold])

  const folded = Boolean(fold) && !expanded && overflowRows > 0
  return (
    <div className="min-w-0" data-v4-markdown="true" data-folded={folded ? 'true' : undefined}>
      <div ref={bodyRef} className={folded ? 'overflow-hidden' : undefined} style={folded ? { maxHeight: fold } : undefined}>
        <NomiMarkdown
          compact
          profile="agent-v4"
          copyLabel={t('agentPanelV4.copy')}
          imageLabel={t('agentPanelV4.image')}
          expandLabel={t('agentPanelV4.expand')}
          collapseLabel={t('agentPanelV4.collapse')}
        >
          {text}
        </NomiMarkdown>
      </div>
      {overflowRows > 0 && fold ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 inline-flex items-center gap-1 text-caption text-nomi-ink-60"
        >
          <IconChevronDown size={12} className={expanded ? 'rotate-180' : undefined} />
          {expanded ? t('agentPanelV4.collapse') : t('agentPanelV4.moreRows', { count: overflowRows })}
        </button>
      ) : null}
    </div>
  )
}
