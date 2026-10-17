import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'

/**
 * 失败详情的三件套——「服务商原话」「复制详情」「技术详情」——**一份实现**，失败卡（NodeErrorReport）
 * 与可找回面板（NodeRecoverableReport）共用。
 *
 * 为什么抽出来（#1213）：可找回面板以前只有一句固定文案，最后一次取回失败的原话（HTTP 503 无可用渠道 /
 * 404 / 出站被拦……）存在节点上却从不显示——用户截图里什么证据都没有，自己也没法判断该怎么办。
 * 给它补原话时不另画一套：照搬失败卡这三样的原样式，抄一份就是第二处要同步的界面（P1）。
 */

/** 服务商真实原话：提到可见区，不让用户去折叠的「技术详情」里挖。break-words：上游原话常是一整串没空格的 JSON/URL。 */
export function ProviderMessageNote({ text }: { text: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <p className="mt-2 select-text cursor-text break-words rounded-nomi-sm bg-nomi-ink-05 p-2 text-caption leading-relaxed text-nomi-ink-60">
      <span className="text-nomi-ink-40">{t('generationCommon.error.providerMessage')}</span>
      {text}
    </p>
  )
}

/** 展开后的原始错误全文（可选中、可滚动）。 */
export function TechnicalDetailsBlock({ raw }: { raw: string }): JSX.Element {
  return (
    <pre
      className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'mb-2 max-h-[88px] select-text overflow-auto whitespace-pre-wrap break-all rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-micro text-nomi-ink-60')}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {raw}
    </pre>
  )
}

/** 「复制详情」：把原始错误全文放进剪贴板，点后短暂显示「已复制」。 */
export function CopyDetailsButton({ raw }: { raw: string }): JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  const handleCopy = React.useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation()
      try {
        await navigator.clipboard.writeText(raw)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      } catch {
        /* read-only env */
      }
    },
    [raw],
  )
  return (
    <button type="button" onClick={handleCopy} className="shrink-0 whitespace-nowrap text-caption text-nomi-ink-40 hover:text-nomi-ink">
      {copied ? t('generationCommon.error.copied') : t('generationCommon.error.copyDetails')}
    </button>
  )
}

/** 「技术详情」开关（展开 / 收起 TechnicalDetailsBlock）。 */
export function TechnicalDetailsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      aria-expanded={open}
      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-micro text-nomi-ink-40 hover:text-nomi-ink-60"
    >
      {t('generationCommon.error.technicalDetails')}
      {open ? <IconChevronDown size={13} stroke={1.6} /> : <IconChevronRight size={13} stroke={1.6} />}
    </button>
  )
}
