/**
 * 模型 chip 列表（按 kind 分组）。替代旧的「逐行 + 重复状态」清单（密度问题根因）。
 * 规范：docs/plan/2026-06-07-onboarding-panel-redesign.md §5.2
 *
 * 2026-07-17 用户需求：chip 可选中/取消（= 模型 enabled 启停）。选中的模型进对应节点的
 * 模型切换列表（节点下拉只取 enabled + 已连通厂商，见 modelCatalogCache），取消的不显示。
 * 传 onToggle 即开启交互（chip 变 button + aria-pressed）；不传保持纯展示（老用法零影响）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { groupModelsByKind, sortEnabledFirst, type ModelChipKind } from './modelChipGrouping'

export type ChipModel = {
  modelKey: string
  vendorKey: string
  labelZh: string
  kind: ModelChipKind
  /** 是否启用（enabled:false 的模型不进生成下拉/runtime，供中转站批量启停编辑用）。 */
  enabled: boolean
  /** 后端模型扩展信息；通用 chip 不消费，专用卡可透传读取。 */
  meta?: unknown
}

type ModelChipGroupsProps = {
  models: ChipModel[]
  /** 状态点：true=已连通（绿）/ false=未连通（灰）。 */
  connected: boolean
  /** 传入则 chip 可点选启停（选中=enabled=进节点模型列表；取消=隐藏）。 */
  onToggle?: (model: ChipModel, enabled: boolean) => void
  /** 传入则每个 chip 末尾出现 × 删除（用于自定义模型）。 */
  onDelete?: (model: ChipModel) => void
}

export function ModelChipGroups({ models, connected, onToggle, onDelete }: ModelChipGroupsProps): JSX.Element | null {
  const { t } = useTranslation()
  if (models.length === 0) return null

  return (
    <>
      {groupModelsByKind(models).map(({ kind, models: list }) => {
        const enabledN = list.filter((m) => m.enabled).length
        // 可切换模式下已启用排前（用户 2026-07-17）；纯展示卡保持 seed 原序。
        const ordered = onToggle ? sortEnabledFirst(list) : list
        return (
          <div key={kind} className="flex flex-col gap-2">
            <div className="text-micro font-semibold text-nomi-ink-60">
              {kind in { text: 1, image: 1, video: 1, audio: 1, model3d: 1 }
                ? t(`onboardingProviders.modelControls.kind.${kind}` as 'onboardingProviders.modelControls.kind.text')
                : kind}{' '}
              <span className="font-normal text-nomi-ink-40">
                {onToggle ? `${enabledN} / ${list.length}` : list.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ordered.map((m) => {
                const chipInner = (
                  <>
                    {onToggle && m.enabled ? (
                      <IconCheck size={12} stroke={2.4} className="text-nomi-accent" aria-hidden="true" />
                    ) : (
                      <span className={cn('w-1.5 h-1.5 rounded-full', connected && m.enabled ? 'bg-workbench-success' : 'bg-nomi-ink-20')} />
                    )}
                    {m.labelZh}
                    {onDelete ? (
                      // span role=button 而非 <button>：chip 在 toggle 模式下本身是 button，嵌套 button 非法。
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={t('onboardingProviders.modelControls.removeModelAria', { name: m.labelZh })}
                        onClick={(event) => {
                          event.stopPropagation()
                          onDelete(m)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.stopPropagation()
                            onDelete(m)
                          }
                        }}
                        className="ml-0.5 inline-flex cursor-pointer text-nomi-ink-30 hover:text-workbench-danger"
                      >
                        <IconX size={12} stroke={2} />
                      </span>
                    ) : null}
                  </>
                )
                if (!onToggle) {
                  return (
                    <span
                      key={`${m.vendorKey}-${m.modelKey}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-nomi-line text-caption text-nomi-ink-80"
                    >
                      {chipInner}
                    </span>
                  )
                }
                return (
                  <button
                    key={`${m.vendorKey}-${m.modelKey}`}
                    type="button"
                    aria-pressed={m.enabled}
                    title={m.enabled ? t('onboardingProviders.modelControls.enabledTitle') : t('onboardingProviders.modelControls.hiddenTitle')}
                    onClick={() => onToggle(m, !m.enabled)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-caption cursor-pointer',
                      'transition-colors duration-[var(--nomi-transition-fast)]',
                      m.enabled
                        ? 'border-nomi-accent-soft bg-nomi-accent-soft text-nomi-ink hover:border-nomi-accent'
                        : 'border-nomi-line text-nomi-ink-40 hover:border-nomi-ink-20 hover:text-nomi-ink-60',
                    )}
                  >
                    {chipInner}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}
