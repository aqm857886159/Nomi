/**
 * 中转站/自定义模型的「就地内嵌编辑」：搜索 + 全选/全不选 + 按 kind 分组 + 逐模型勾选启停 + 计数 + 删除（单个/批量）。
 * 用户拍板（2026-07-04「就地内嵌」）。中转站一拉几十上百个模型，此前只能逐个 × 删（不可逆、要重拉）；
 * 这里让每个模型可勾选启用/停用（可逆，enabled:false 天然从生成下拉/runtime 消失），垃圾桶仍是彻底删除。
 * 批量删除（2026-07-15 用户群反馈：462 个自定义模型只能逐个删=鸡肋）：进「选择删除」模式勾多行一次删；
 * 配合搜索可精准删某一类（搜 flux → 全选 → 删除选中）。数据结构零改动——enabled 字段与生成侧过滤都现成。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconSearch, IconTrash, IconCheck, IconCode } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiSelect } from '../../design'
import type { ChipModel } from './ModelChipGroups'
import { groupModelsByKind, isKnownModelChipKind, MODEL_CHIP_KINDS } from './modelChipGrouping'
import { bulkToggleTargets, enabledCount, filterModelsByQuery, modelRowKey, selectedModelRows } from './modelEnableEditing'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import { isAdapterModelLocked } from './adapterVerificationViewModel'

type ModelEnableEditorProps = {
  models: ChipModel[]
  /** 批量翻转启用态（单个=1 行；批量=多行）。由父层逐行 upsert 后一次 refresh。 */
  onToggle: (rows: ChipModel[], enabled: boolean) => void
  /** 彻底删除（不可逆，需重拉）。单删=1 行；批删=多行。父层弹一次确认框后一次删 + 一次 refresh。 */
  onDelete: (rows: ChipModel[]) => void
  /** 传入则每行显示「自定义调用」动作（仅中转/自定义家用；已设脚本=图标点亮+角标）。 */
  onCustomCall?: (row: ChipModel) => void
  /**
   * 传入则可改类型的行上出现类型选择器（改 kind + 重建调用通道，父层包 IPC）。
   * 为什么这个控件必须**常驻可见**而不是收进 hover/二级：接入时的类型是猜的、必然有猜错的，
   * 而猜错之后模型不是报错、是**从对应下拉里消失**——用户永远不会想到「去某个二级菜单改类型」。
   * 把它摆在行上，「这条被登记成什么」和「原来能改」才同时可见（这正是此前唯一缺失的信息）。
   */
  onRetype?: (row: ChipModel, kind: string) => void
  /** 连接详情页使用：点击模型名进入同一右侧区域的模型详情。 */
  onOpenModel?: (row: ChipModel) => void
}

const PILL = 'h-6 px-2.5 rounded-full border text-micro inline-flex items-center gap-1'

export function ModelEnableEditor({ models, onToggle, onDelete, onCustomCall, onRetype, onOpenModel }: ModelEnableEditorProps): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [selectMode, setSelectMode] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const visible = React.useMemo(() => filterModelsByQuery(models, query), [models, query])
  const groups = React.useMemo(() => groupModelsByKind(visible), [visible])
  const enabledTotal = enabledCount(models)
  const selectedRows = React.useMemo(() => selectedModelRows(models, selected), [models, selected])

  const bulk = React.useCallback((enable: boolean) => {
    const targets = bulkToggleTargets(visible, enable).filter(model => !isAdapterModelLocked(model.meta))
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
          aria-label={t('onboardingProviders.modelControls.searchAria')}
          placeholder={t('onboardingProviders.modelControls.searchPlaceholder')}
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
                {allVisibleSelected ? t('onboardingProviders.modelControls.selectNone') : t('onboardingProviders.modelControls.selectAll')}
              </button>
              <button type="button" onClick={exitSelect} className={cn(PILL, 'border-nomi-line text-nomi-ink-60 hover:border-nomi-ink-20')}>
                {t('common.cancel')}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-micro text-nomi-ink-40">{t('onboardingProviders.modelControls.selectedCount', { count: selectedRows.length })}</span>
              <button
                type="button"
                disabled={selectedRows.length === 0}
                onClick={handleDeleteSelected}
                className={cn(PILL, 'border-[var(--workbench-danger-soft)] text-workbench-danger hover:bg-[var(--workbench-danger-soft)] disabled:opacity-40')}
              >
                <IconTrash size={12} stroke={1.8} />{t('onboardingProviders.modelControls.deleteSelected')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => bulk(true)} className={cn(PILL, 'border-nomi-line text-nomi-ink-60 hover:border-nomi-ink-20')}>
                {t('onboardingProviders.modelControls.selectAll')}
              </button>
              <button type="button" onClick={() => bulk(false)} className={cn(PILL, 'border-nomi-line text-nomi-ink-60 hover:border-nomi-ink-20')}>
                {t('onboardingProviders.modelControls.selectNone')}
              </button>
              {models.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectMode(true)}
                  className={cn(PILL, 'border-nomi-line text-nomi-ink-60 hover:text-workbench-danger hover:border-[var(--workbench-danger-soft)]')}
                >
                  <IconTrash size={12} stroke={1.8} />{t('onboardingProviders.modelControls.bulkDelete')}
                </button>
              ) : null}
            </div>
            <span className="text-micro text-nomi-ink-40">{t('onboardingProviders.modelControls.enabledCount', { enabled: enabledTotal, total: models.length })}</span>
          </>
        )}
      </div>

      {/* 分组列表 */}
      {groups.length === 0 ? (
        <div className="text-caption text-nomi-ink-40 text-center py-5">{t('onboardingProviders.modelControls.noMatchQuery', { query })}</div>
      ) : (
        <div className="flex flex-col max-h-[300px] overflow-y-auto -mx-1 px-1">
          {groups.map((g) => (
            <div key={g.kind}>
              <div className="text-micro font-semibold text-nomi-ink-60 mt-2 mb-1 px-1">
                {isKnownModelChipKind(g.kind) ? t(`onboardingProviders.modelControls.kind.${g.kind}` as 'onboardingProviders.modelControls.kind.text') : g.kind}{' '}
                <span className="font-normal text-nomi-ink-40">{enabledCount(g.models)}/{g.models.length}</span>
              </div>
              {g.models.map((m) => {
                const key = modelRowKey(m)
                const adapterLocked = isAdapterModelLocked(m.meta)
                if (selectMode) {
                  const isSelected = selected.has(key)
                  return (
                    <button
                      key={`${m.vendorKey}-${m.modelKey}`}
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={t(isSelected ? 'onboardingProviders.modelControls.deselectModelAria' : 'onboardingProviders.modelControls.selectModelAria', { name: m.labelZh })}
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
                        {translateModelDisplayText(m.labelZh)}
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
                      disabled={adapterLocked}
                      aria-label={t(m.enabled ? 'onboardingProviders.modelControls.disableModelAria' : 'onboardingProviders.modelControls.enableModelAria', { name: m.labelZh })}
                      onClick={() => onToggle([m], !m.enabled)}
                      className={cn(
                        'w-[18px] h-[18px] rounded-nomi-sm shrink-0 grid place-items-center border',
                        adapterLocked
                          ? 'bg-nomi-ink-05 border-nomi-line text-nomi-ink-20 cursor-not-allowed'
                          : m.enabled
                          ? 'bg-nomi-accent border-nomi-accent text-nomi-paper'
                          : 'bg-nomi-paper border-nomi-ink-20 text-transparent',
                      )}
                    >
                      <IconCheck size={12} stroke={2.4} />
                    </button>
                    <button
                      type="button"
                      disabled={!onOpenModel && adapterLocked}
                      onClick={() => {
                        if (onOpenModel) onOpenModel(m)
                        else onToggle([m], !m.enabled)
                      }}
                      className={cn(
                        'flex-1 min-w-0 text-left text-body-sm truncate',
                        !onOpenModel && adapterLocked ? 'cursor-not-allowed text-nomi-ink-40' : m.enabled ? 'text-nomi-ink' : 'text-nomi-ink-60',
                      )}
                    >
                      {translateModelDisplayText(m.labelZh)}
                    </button>
                    {m.customCallDraft ? (
                      <span className="shrink-0 rounded-nomi-sm bg-nomi-accent-soft px-1.5 py-0.5 text-micro text-nomi-accent">
                        {t('onboardingProviders.customCall.directDraft.badge')}
                      </span>
                    ) : null}
                    {onRetype && m.canRetype ? (
                      <NomiSelect
                        value={m.kind}
                        options={MODEL_CHIP_KINDS.map((k) => ({
                          value: k,
                          label: t(`onboardingProviders.modelControls.kind.${k}` as 'onboardingProviders.modelControls.kind.text'),
                        }))}
                        onChange={(next) => { if (next !== m.kind) onRetype(m, next) }}
                        ariaLabel={t('onboardingProviders.modelControls.retypeAria', { name: m.labelZh })}
                        title={t('onboardingProviders.modelControls.retypeTitle')}
                        size="xs"
                        className="shrink-0"
                      />
                    ) : null}
                    {onCustomCall ? (
                      <button
                        type="button"
                        aria-label={t(
                          m.customCallDraft
                            ? 'onboardingProviders.customCall.directDraft.rowAria'
                            : m.hasCustomCall
                            ? 'onboardingProviders.customCall.rowSetAria'
                            : 'onboardingProviders.customCall.rowAria',
                          { name: m.labelZh },
                        )}
                        title={t(m.customCallDraft
                          ? 'onboardingProviders.customCall.directDraft.rowTitle'
                          : m.hasCustomCall
                            ? 'onboardingProviders.customCall.rowSetTitle'
                            : 'onboardingProviders.customCall.rowTitle')}
                        onClick={() => onCustomCall(m)}
                        className={cn(
                          'relative shrink-0 p-1',
                          m.hasCustomCall ? 'text-nomi-accent' : 'text-nomi-ink-30 hover:text-nomi-ink-60',
                        )}
                      >
                        <IconCode size={13} stroke={1.8} />
                        {m.hasCustomCall ? (
                          <span className="absolute right-[1px] top-[1px] size-[6px] rounded-full bg-nomi-accent" />
                        ) : null}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={t('onboardingProviders.modelControls.deleteModelAria', { name: m.labelZh })}
                      title={t('onboardingProviders.modelControls.deleteModelTitle')}
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
