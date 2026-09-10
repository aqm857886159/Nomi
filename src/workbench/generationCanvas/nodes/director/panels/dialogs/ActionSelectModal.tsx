/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design（DesignModal / WorkbenchButton）、../../../../../../vendor/tablerIcons、../../../../../../utils/cn、
 *          ../../model/actionLibrary（ACTION_LIBRARY / ActionLibraryEntry / resolveActionAlias）、../../scene/character/poseClipLibrary 的 poseClipInfo、./ActionPreview
 * [OUTPUT]: 对外提供 ActionSelectModal：左 搜索「搜索动作名称...」+ 动作列表（图标 / 名字 / 「连续动作 (循环)」或「单帧姿态」/ 当前勾选，双击直接添加；无结果「未找到相关动作」）
 *           右 「动作实时预览」+ 动画 / 静态 徽标 + 重置视角 + 3D 预览 + 「当前动作 X」；底部 提示 + 「添加「X」片段」
 * [POS]: director/panels/dialogs 的动作库弹窗：初选 = walking 别名（行走）；循环 / 静态按 FBX 时长判定（参考产品按 walking/jogging/sprint_start/crawling 四个别名判，
 *        与它自己的库 id 不相交、全部显示成「单帧姿态」，属实现瑕疵，这里按意图实现）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { DesignModal, WorkbenchButton } from '../../../../../../design'
import { IconLoader2, IconMoodConfuzed, IconRefresh, IconRun, IconSearch, IconUser, IconX } from '../../../../../../vendor/tablerIcons'
import { cn } from '../../../../../../utils/cn'
import { ACTION_LIBRARY, resolveActionAlias, type ActionLibraryEntry } from '../../model/actionLibrary'
import { poseClipInfo } from '../../scene/character/poseClipLibrary'
import { ActionPreview } from './ActionPreview'

const INITIAL_ACTION = resolveActionAlias('walking')?.id ?? ACTION_LIBRARY[1]?.id ?? ACTION_LIBRARY[0].id

export function ActionSelectModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (entry: ActionLibraryEntry) => void }): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string>(INITIAL_ACTION)
  const [ready, setReady] = React.useState(false)
  const [resetSignal, setResetSignal] = React.useState(0)
  const onReady = React.useCallback(() => setReady(true), [])

  const entries = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return ACTION_LIBRARY
    return ACTION_LIBRARY.filter((entry) => entry.id.toLowerCase().includes(needle) || String(t(`director.action.library.${entry.id}`)).toLowerCase().includes(needle))
  }, [query, t])
  const selected = ACTION_LIBRARY.find((entry) => entry.id === selectedId) ?? null
  const isLoop = (id: string) => {
    const info = poseClipInfo(id)
    return info ? !info.isStatic : false
  }
  const pick = (entry: ActionLibraryEntry) => {
    onPick(entry)
    onClose()
  }

  return (
    <DesignModal opened={open} onClose={onClose} title={t('director.action.modalTitle')} size="xl" centered>
      <div className="flex h-[440px] gap-3">
        {/* 左：搜索 + 列表 */}
        <div className="flex w-[300px] shrink-0 flex-col gap-2">
          <label className="relative flex items-center">
            <IconSearch size={14} stroke={2} className="pointer-events-none absolute left-2.5 text-nomi-ink-40" />
            <input
              className="w-full rounded-nomi border border-nomi-line bg-nomi-bg py-1.5 pl-8 pr-8 text-caption text-nomi-ink outline-none placeholder:text-nomi-ink-40 focus:border-nomi-ink-40"
              value={query}
              placeholder={t('director.action.search')}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" className="absolute right-2.5 text-nomi-ink-40 hover:text-nomi-ink" aria-label={t('director.fields.reset')} onClick={() => setQuery('')}>
                <IconX size={14} stroke={2} />
              </button>
            ) : null}
          </label>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-0.5" role="listbox" aria-label={t('director.action.modalTitle')}>
            {entries.map((entry) => {
              const active = selectedId === entry.id
              const loop = isLoop(entry.id)
              const label = t(`director.action.library.${entry.id}`)
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={t('director.action.hintDoubleClick')}
                  className={cn(
                    'group flex items-center justify-between rounded-nomi border px-3 py-2 text-left transition-colors',
                    active ? 'border-nomi-ink-40 bg-nomi-ink-10 text-nomi-ink' : 'border-nomi-line-soft bg-nomi-ink-05 text-nomi-ink-80 hover:bg-nomi-ink-10 hover:text-nomi-ink',
                  )}
                  onClick={() => setSelectedId(entry.id)}
                  onDoubleClick={() => pick(entry)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-nomi-sm', active ? 'bg-nomi-ink/10 text-nomi-ink' : 'bg-nomi-ink-05 text-nomi-ink-40 group-hover:text-nomi-ink')}>
                      {loop ? <IconRun size={14} stroke={2} /> : <IconUser size={14} stroke={2} />}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-body-sm font-medium">{label}</span>
                      <span className="text-micro text-nomi-ink-40">{loop ? t('director.action.kindLoop') : t('director.action.kindStatic')}</span>
                    </span>
                  </span>
                  {active ? <span className="size-2 shrink-0 rounded-full bg-nomi-ink" aria-hidden /> : null}
                </button>
              )
            })}
            {entries.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-8 text-caption text-nomi-ink-40">
                <IconMoodConfuzed size={24} stroke={1} />
                <span>{t('director.action.notFound')}</span>
              </div>
            ) : null}
          </div>
        </div>
        {/* 右：实时预览 */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-caption font-medium text-nomi-ink-80">
              {t('director.action.previewTitle')}
              {selected ? (
                <span className="rounded-nomi-sm bg-nomi-ink-05 px-1.5 py-0.5 font-nomi-mono text-micro text-nomi-ink-60">{isLoop(selected.id) ? t('director.action.previewAnimated') : t('director.action.previewStatic')}</span>
              ) : null}
            </span>
            <button type="button" className="flex items-center gap-1 text-micro text-nomi-ink-40 hover:text-nomi-ink" title={t('director.action.previewResetHint')} onClick={() => setResetSignal((value) => value + 1)}>
              <IconRefresh size={11} stroke={2} />
              {t('director.action.previewReset')}
            </button>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-nomi bg-nomi-ink">
            {open && selected ? <ActionPreview actionId={selected.id} resetSignal={resetSignal} onReady={onReady} /> : null}
            {!ready ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-caption text-nomi-paper/70">
                <IconLoader2 size={16} stroke={2} className="animate-spin" />
                {t('director.action.previewLoading')}
              </div>
            ) : null}
          </div>
          {selected ? (
            <div className="flex items-center justify-between rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-caption">
              <span className="text-nomi-ink-40">{t('director.action.previewCurrent')}</span>
              <span className="font-medium text-nomi-ink">{t(`director.action.library.${selected.id}`)}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-nomi-line-soft pt-2">
        <span className="text-micro text-nomi-ink-40">{t('director.action.hintDoubleClick')}</span>
        <WorkbenchButton size="sm" variant="primary" disabled={!selected} onClick={() => selected && pick(selected)}>
          {t('director.action.addNamed', { name: selected ? t(`director.action.library.${selected.id}`) : t('director.timeline.family.action') })}
        </WorkbenchButton>
      </div>
    </DesignModal>
  )
}
