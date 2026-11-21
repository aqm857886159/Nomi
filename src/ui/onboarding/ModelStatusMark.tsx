/**
 * 模型 / 连接状态在界面上的**唯一**画法（D-1117-delete-verification）。
 *
 * 词、点色都只从 `electron/shared/modelStatusPresentation.ts` 来；这里只管把它画成三种现有形状之一：
 *   · row   —— 设置首页连接行尾的「点 + 字」；
 *   · pill  —— 连接详情卡头的胶囊（FoldableModelCard 的同一副外形）；
 *   · text  —— 模型详情状态区的标题字。
 * 形状是原有的，没有新元素；变的只是取词取色的来源——以前每个出口各挑各的词、各配各的色，
 * 同一个模型在列表、内置详情、自接详情里能说三句话。
 *
 * 出口里不许自己 `t('onboardingProviders.modelStatus.*')`：ESLint 规则 `nomi/model-status-one-home` 拦，
 * 词条键由展示投影给出，标签翻译只复用 modelSettingsHomeState 的同一份 hook。
 */
import type { JSX } from 'react'
import type {
  ConnectionStatusPresentation,
  ModelStatusPresentation,
  ModelStatusTone,
} from '../../../electron/shared/modelStatusPresentation'
import { cn } from '../../utils/cn'
import { useModelStatusLabel } from './modelSettingsHomeState'

const DOT_CLASS: Record<ModelStatusTone, string> = {
  success: 'bg-workbench-success',
  active: 'bg-nomi-accent',
  warning: 'bg-nomi-warning',
  neutral: 'bg-nomi-ink-30',
}

/** 行尾那种不带底色的写法：绿档的字保持中性灰（点已经说了「能用」），其余字随点色。 */
const ROW_TEXT_CLASS: Record<ModelStatusTone, string> = {
  success: 'text-nomi-ink-60',
  active: 'text-nomi-accent',
  warning: 'text-nomi-warning',
  neutral: 'text-nomi-ink-40',
}

type Status = ModelStatusPresentation | ConnectionStatusPresentation

export function ModelStatusMark({
  status,
  variant,
  className,
}: {
  status: Status
  variant: 'row' | 'pill' | 'text'
  className?: string
}): JSX.Element {
  const label = useModelStatusLabel(status)
  if (variant === 'text') {
    return <span data-model-status={status.state} className={className}>{label}</span>
  }
  return (
    <span
      data-model-status={status.state}
      data-model-status-tone={status.tone}
      className={cn(
        variant === 'row'
          ? cn('inline-flex max-w-[48%] shrink-0 items-center gap-1.5 text-right text-micro', ROW_TEXT_CLASS[status.tone])
          : 'inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-micro font-semibold shrink-0 bg-nomi-ink-10 text-nomi-ink-60',
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[status.tone])} />
      {label}
    </span>
  )
}
