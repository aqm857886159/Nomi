/**
 * 中转站/自定义模型的「就地内嵌编辑」：搜索 + 全选/全不选 + 按 kind 分组 + 逐模型勾选启停 + 计数 + 删除（单个/批量）。
 * 用户拍板（2026-07-04「就地内嵌」）。中转站一拉几十上百个模型，此前只能逐个 × 删（不可逆、要重拉）；
 * 这里让每个模型可勾选启用/停用（可逆，enabled:false 天然从生成下拉/runtime 消失），垃圾桶仍是彻底删除。
 * 批量删除（2026-07-15 用户群反馈：462 个自定义模型只能逐个删=鸡肋）：进「选择删除」模式勾多行一次删；
 * 配合搜索可精准删某一类（搜 flux → 全选 → 删除选中）。数据结构零改动——enabled 字段与生成侧过滤都现成。
 */
import React from 'react'
import { IconSearch, IconTrash, IconCheck } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import type { ChipModel } from './ModelChipGroups'
import { groupModelsByKind, MODEL_CHIP_KIND_LABEL } from './modelChipGrouping'
import { bulkToggleTargets, enabledCount, filterModelsByQuery, modelRowKey, selectedModelRows } from './modelEnableEditing'

type ModelEnableEditorProps = {
  models: ChipModel[]
  /** 批量翻转启用态（单个=1 行；批量=多行）。由父层逐行 upsert 后一次 refresh。 */
  onToggle: (rows: ChipModel[], enabled: boolean) => void
  /** 彻底删除（不可逆，需重拉）。单删=1 行；批删=多行。父层弹一次确认框后一次删 + 一次 refresh。 */
  onDelete: (rows: ChipModel[]) => void
}

const PILL = 'h-6 px-2.5 rounded-full border text-micro inline-flex items-center gap-1'

export function ModelEnableEditor({ models, onToggle, onDelete }: ModelEnableEditorProps): JSX.Element {
  const [query, setQuery] = React.useState('')
  const [selectMode, setSelectMode] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const visible = React.useMemo(() => filterModelsByQuery(models, query), [models, query])
  const groups = React.useMemo(() => groupModelsByKind(visible), [visible])
  const enabledTotal = enabledCount(models)
  const selectedRows = React.useMemo(() => selectedModelRows(models, selected), [models, selected])

  const bulk = React.useCallback((enable: boolean) => {
    const targets = bulkToggleTargets(visible, enable)
    if (targets.length > 0) onToggle(targets, enable)
  }, [visible, onToggle])

  const exitSelect = React.useCallback(() => {
    setSelectMode(false)
    setSelected(new Set())
  }, [])

  const toggleSelect = React.useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 选择模式的「全选」= 选中当前可见（搜索过滤后）全部；已全选时再点 = 全不选。配合搜索 = 精准删某一类。
  const allVisibleSelected = visible.length > 0 && visible.every((m) => selected.has(modelRowKey(m)))
  const toggleSelectAllVisible = React.useCallback(() => {
    setSelected((prev) => {
      const keys = visible.map(modelRowKey)
      const everyOn = keys.length > 0 && keys.every((k) => prev.has(k))
      const next = new Set(prev)
      keys.forEach((k) => (everyOn ? next.delete(k) : next.add(k)))
      return next
    })
  }, [visible])

  const handleDeleteSelected = React.useCallback(() => {
    if (selectedRows.length === 0) return
    // 父层弹确认；确认后一次删 + refresh，models 收缩，selected 里的陈旧键被 selectedModelRows 自动忽略。
    onDelete(selectedRows)
    exitSelect()
  }, [selectedRows, onDelete, exitSelect])

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

      {/* 工具条：普通=全选/全不选/批量删除 + 计数；选择模式=全选可见/取消 + 已选N/删除选中 */}
      <div className="flex items-center justify-between gap-2">
        {selectMode ? (
          <>
            <div className="flex gap-1.5">
              <button type="button" onClick={toggleSelectAllVisible} className={cn(PILL, 'border-nomi-line text-nomi-ink-60 hover:border-nomi-ink-20')}>
                {allVisibleSelected ? '全不选' : '全选'}
              </button>
              <button type="button" onClick={exitSelect} className={cn(PILL, 'border-nomi-line text-nomi-ink-60 hover:border-nomi-ink-20')}>
                取消
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-micro text-nomi-ink-40">已选 <b className="text-nomi-ink font-semibold">{selectedRows.length}</b></span>
              <button
                type="button"
                disabled={selectedRows.length === 0}
                onClick={handleDeleteSelected}
                className={cn(PILL, 'border-[var(--workbench-danger-soft)] text-workbench-danger hover:bg-[var(--workbench-danger-soft)] disabled:opacity-40')}
              >
                <IconTrash size={12} stroke={1.8} />删除选中
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => bulk(true)} className={cn(PILL, 'border-nomi-line text-nomi-ink-60 hover:border-nomi-ink-20')}>
                全选
              </button>
              <button type="button" onClick={() => bulk(false)} className={cn(PILL, 'border-nomi-line text-nomi-ink-60 hover:border-nomi-ink-20')}>
                全不选
              </button>
              {models.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectMode(true)}
                  className={cn(PILL, 'border-nomi-line text-nomi-ink-60 hover:text-workbench-danger hover:border-[var(--workbench-danger-soft)]')}
                >
                  <IconTrash size={12} stroke={1.8} />批量删除
                </button>
              ) : null}
            </div>
            <span className="text-micro text-nomi-ink-40">
              已启用 <b className="text-nomi-ink font-semibold">{enabledTotal}</b> / {models.length}
            </span>
          </>
        )}
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
              {g.models.map((m) => {
                const key = modelRowKey(m)
                if (selectMode) {
                  const isSelected = selected.has(key)
                  return (
                    <button
                      key={`${m.vendorKey}-${m.modelKey}`}
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={`${isSelected ? '取消选择' : '选择'} ${m.labelZh}`}
                      onClick={() => toggleSelect(key)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-nomi-sm text-left hover:bg-nomi-ink-05',
                        m.enabled ? '' : 'opacity-55',
                      )}
                    >
                      <span
                        className={cn(
                          'w-[18px] h-[18px] rounded-nomi-sm shrink-0 grid place-items-center border',
                          isSelected
                            ? 'bg-workbench-danger border-workbench-danger text-nomi-paper'
                            : 'bg-nomi-paper border-nomi-ink-20 text-transparent',
                        )}
                      >
                        <IconCheck size={12} stroke={2.4} />
                      </span>
                      <span className={cn('flex-1 min-w-0 text-body-sm truncate', m.enabled ? 'text-nomi-ink' : 'text-nomi-ink-60')}>
                        {m.labelZh}
                      </span>
                    </button>
                  )
                }
                return (
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
                      onClick={() => onDelete([m])}
                      className="shrink-0 p-1 text-nomi-ink-30 hover:text-workbench-danger"
                    >
                      <IconTrash size={13} stroke={1.7} />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
