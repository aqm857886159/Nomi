// 对话错误卡（CR-B1 方案 A）：两个 agent（创作助手 / 生成助手）对话里的错误统一渲染面。
// 替掉「错误像普通灰字回复、还带复制、甩英文机器报错」——红色语气一眼是错误，人话 reason+hint
// 出自 classifyGenerationError（与生成节点错误同一真相源，P1），按错误类给一键出路，原始报错收进
// 可展开「技术详情」。版式镜像 NoTextModelRecoveryCard（身份行 + 卡），两张错误态卡长得一致。
import React from 'react'
import { IconAlertTriangle, IconRefresh, IconSettings, IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { WorkbenchButton } from '../../design'
import { classifyGenerationError } from '../observability/classifyError'
import { NomiIdentityRow } from './AssistantMessageView'

export function AssistantErrorCard({ error, onRetry }: {
  /** 原始错误文本（message.content）；卡内部分类成人话，调用方不用预处理。 */
  error: string
  /** 提供则显示「重试」= 重发上一条用户消息。 */
  onRetry?: () => void
}): JSX.Element {
  const [detailOpen, setDetailOpen] = React.useState(false)
  const report = React.useMemo(() => classifyGenerationError(error), [error])
  const openCatalog = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))
  }, [])
  // 技术详情只在原始报错比人话更具体时才给（unknown 类 reason 本身=原话，不重复）。
  const hasDetail = Boolean(report.raw) && report.raw !== report.reason

  return (
    <div className={cn('self-start w-full max-w-full')} data-role="assistant" data-assistant-error="true">
      <NomiIdentityRow />
      <div className={cn('flex flex-col gap-3 p-3 rounded-nomi border border-workbench-danger bg-workbench-danger-soft')}>
        <div className={cn('flex items-start gap-2')}>
          <IconAlertTriangle size={17} stroke={1.8} className={cn('mt-0.5 shrink-0 text-workbench-danger')} />
          <div className={cn('flex flex-col gap-1 min-w-0')}>
            <span className={cn('text-body-sm font-medium text-nomi-ink leading-snug')}>{report.reason}</span>
            {report.hint ? (
              <span className={cn('text-caption text-nomi-ink-80 leading-snug')}>{report.hint}</span>
            ) : null}
            {report.providerMessage ? (
              <span className={cn('text-caption text-nomi-ink-60 leading-snug')}>服务商：{report.providerMessage}</span>
            ) : null}
          </div>
        </div>

        {/* flex-wrap + shrink-0：窄面板放不下时整组优雅换行，不挤压不竖排。 */}
        <div className={cn('flex flex-wrap items-center gap-2')}>
          {onRetry ? (
            <WorkbenchButton className={cn('shrink-0')} variant="default" size="sm" data-assistant-error-retry="true" onClick={onRetry}>
              <IconRefresh size={14} stroke={1.8} />
              重试
            </WorkbenchButton>
          ) : null}
          <WorkbenchButton className={cn('shrink-0')} variant="default" size="sm" onClick={openCatalog}>
            <IconSettings size={14} stroke={1.8} />
            去模型接入
          </WorkbenchButton>
          {hasDetail ? (
            <button
              type="button"
              className={cn(
                'ml-auto shrink-0 inline-flex items-center gap-1 border-0 bg-transparent p-0 cursor-pointer whitespace-nowrap',
                'text-caption text-nomi-ink-60 hover:text-nomi-ink',
              )}
              onClick={() => setDetailOpen((open) => !open)}
            >
              {detailOpen ? <IconChevronDown size={12} stroke={1.8} /> : <IconChevronRight size={12} stroke={1.8} />}
              技术详情
            </button>
          ) : null}
        </div>

        {detailOpen && hasDetail ? (
          <pre className={cn('m-0 p-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line text-micro text-nomi-ink-60 whitespace-pre-wrap [overflow-wrap:anywhere]')}>
            {report.raw}
          </pre>
        ) : null}
      </div>
    </div>
  )
}
