/**
 * 中转站/自定义模型的「就地内嵌编辑」：搜索 + 全选/全不选 + 按 kind 分组 + 逐模型勾选启停 + 计数 + 删除。
 * 用户拍板（2026-07-04「就地内嵌」）。中转站一拉几十上百个模型，此前只能逐个 × 删（不可逆、要重拉）；
 * 这里让每个模型可勾选启用/停用（可逆，enabled:false 天然从生成下拉/runtime 消失），垃圾桶仍是彻底删除。
 * 数据结构零改动——enabled 字段与生成侧过滤都现成（见 plan）。
 */
import React from 'react'
import { IconSearch, IconTrash, IconCheck } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import type { ChipModel } from './ModelChipGroups'
import { groupModelsByKind, MODEL_CHIP_KIND_LABEL } from './modelChipGrouping'
import { bulkToggleTargets, enabledCount, filterModelsByQuery } from './modelEnableEditing'

type ModelEnableEditorProps = {
  models: ChipModel[]
  /** 批量翻转启用态（单个=1 行；批量=多行）。由父层逐行 upsert 后一次 refresh。 */
  onToggle: (rows: ChipModel[], enabled: boolean) => void
  /** 彻底删除（不可逆，需重拉）。 */
  onDelete: (row: ChipModel) => void
}

export function ModelEnableEditor({ models, onToggle, onDelete }: ModelEnableEditorProps): JSX.Element {
  const [query, setQuery] = React.useState('')
  const visible = React.useMemo(() => filterModelsByQuery(models, query), [models, query])
  const groups = React.useMemo(() => groupModelsByKind(visible), [visible])
  const enabledTotal = enabledCount(models)

  const bulk = React.useCallback((enable: boolean) => {
    const targets = bulkToggleTargets(visible, enable)
    if (targets.length > 0) onToggle(targets, enable)
  }, [visible, onToggle])

  return (
    <div className="flex flex-col gap-2.5">
      {/* 搜索 */}
      <div className="relative">
        <IconSearch size={14} stroke={1.7} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nomi-ink-40" />
        <input
          type="text"
          aria-label="搜索模型"
          placeholder="搜索模型名…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          className={cn(
            'w-full h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper pl-8 pr-2.5',
            'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40 outline-none focus:border-nomi-accent',
          )}
        />
      </div>

      {/* 批量 + 计数 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => bulk(true)}
            className="h-6 px-2.5 rounded-full border border-nomi-line text-micro text-nomi-ink-60 hover:border-nomi-ink-20"
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => bulk(false)}
            className="h-6 px-2.5 rounded-full border border-nomi-line text-micro text-nomi-ink-60 hover:border-nomi-ink-20"
          >
            全不选
          </button>
        </div>
        <span className="text-micro text-nomi-ink-40">
          已启用 <b className="text-nomi-ink font-semibold">{enabledTotal}</b> / {models.length}
        </span>
      </div>

      {/* 分组列表 */}
      {groups.length === 0 ? (
        <div className="text-caption text-nomi-ink-40 text-center py-5">没有匹配「{query}」的模型</div>
      ) : (
        <div className="flex flex-col max-h-[300px] overflow-y-auto -mx-1 px-1">
          {groups.map((g) => (
            <div key={g.kind}>
              <div className="text-micro font-semibold text-nomi-ink-60 mt-2 mb-1 px-1">
                {MODEL_CHIP_KIND_LABEL[g.kind] ?? g.kind}{' '}
                <span className="font-normal text-nomi-ink-40">{enabledCount(g.models)}/{g.models.length}</span>
              </div>
              {g.models.map((m) => (
                <div
                  key={`${m.vendorKey}-${m.modelKey}`}
                  className={cn(
                    'group flex items-center gap-2.5 px-2 py-1.5 rounded-nomi-sm hover:bg-nomi-ink-05',
                    m.enabled ? '' : 'opacity-55',
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={m.enabled}
                    aria-label={`${m.enabled ? '停用' : '启用'} ${m.labelZh}`}
                    onClick={() => onToggle([m], !m.enabled)}
                    className={cn(
                      'w-[18px] h-[18px] rounded-nomi-sm shrink-0 grid place-items-center border',
                      m.enabled
                        ? 'bg-nomi-accent border-nomi-accent text-nomi-paper'
                        : 'bg-nomi-paper border-nomi-ink-20 text-transparent',
                    )}
                  >
                    <IconCheck size={12} stroke={2.4} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggle([m], !m.enabled)}
                    className={cn('flex-1 min-w-0 text-left text-body-sm truncate', m.enabled ? 'text-nomi-ink' : 'text-nomi-ink-60')}
                  >
                    {m.labelZh}
                  </button>
                  <button
                    type="button"
                    aria-label={`彻底删除 ${m.labelZh}`}
                    title="彻底移除（需重拉才回来）"
                    onClick={() => onDelete(m)}
                    className="shrink-0 p-1 text-nomi-ink-30 hover:text-workbench-danger"
                  >
                    <IconTrash size={13} stroke={1.7} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
