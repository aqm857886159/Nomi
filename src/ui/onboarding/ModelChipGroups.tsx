/**
 * 模型 chip 列表（按 kind 分组）。替代旧的「逐行 + 重复状态」清单（密度问题根因）。
 * 规范：docs/plan/2026-06-07-onboarding-panel-redesign.md §5.2
 */
import React from 'react'
import { IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { groupModelsByKind, type ModelChipKind } from './modelChipGrouping'

export type ChipModel = {
  modelKey: string
  vendorKey: string
  labelZh: string
  kind: ModelChipKind
}

type ModelChipGroupsProps = {
  models: ChipModel[]
  /** 状态点：true=已连通（绿）/ false=未连通（灰）。 */
  connected: boolean
  /** 传入则每个 chip 末尾出现 × 删除（用于自定义模型）。 */
  onDelete?: (model: ChipModel) => void
}

export function ModelChipGroups({ models, connected, onDelete }: ModelChipGroupsProps): JSX.Element | null {
  if (models.length === 0) return null

  return (
    <>
      {groupModelsByKind(models).map(({ kind, label, models: list }) => {
        return (
          <div key={kind} className="flex flex-col gap-2">
            <div className="text-micro font-semibold text-nomi-ink-60">
              {label} <span className="font-normal text-nomi-ink-40">{list.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {list.map((m) => (
                <span
                  key={`${m.vendorKey}-${m.modelKey}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-nomi-line text-caption text-nomi-ink-80"
                >
                  <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-workbench-success' : 'bg-nomi-ink-20')} />
                  {m.labelZh}
                  {onDelete ? (
                    <button
                      type="button"
                      aria-label={`删除 ${m.labelZh}`}
                      onClick={() => onDelete(m)}
                      className="ml-0.5 inline-flex text-nomi-ink-30 hover:text-workbench-danger"
                    >
                      <IconX size={12} stroke={2} />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
