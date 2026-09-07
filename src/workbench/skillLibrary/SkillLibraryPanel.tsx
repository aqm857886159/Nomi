/**
 * 技能库面板。技能在 App 里唯一的「家」：浏览（我的技能 / Nomi 内置）、搜索、导入文件、用 AI 新建、
 * 导出、删除、一键在创作区使用。设计对齐提示词库（PromptLibraryPanel）：居中模态 + 来源标签 + 卡片网格。
 * 导入/导出纯走渲染层（FileReader 读包 / Blob 下载），不加系统对话框桥；创建只走 AI（复用创作区
 * 「让 AI 帮我写技能」），不做手填 manifest 表单（docs/plan/2026-06-23-skill-library-hub.md）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconBooks, IconUpload, IconWand, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignEmptyState, NomiSegmented, NomiWordmark, TooltipProvider } from '../../design'
import { showInfoToast } from '../../utils/showInfoToast'
import { showUndoToast } from '../../utils/showUndoToast'
import { useWorkbenchStore } from '../workbenchStore'
import type { SkillListItemDto } from '../api/skillApi'
import { useWorkbenchSkills } from './useWorkbenchSkills'
import { parseSkillImportFile } from './parseSkillImport'
import { SkillCard } from './SkillCard'
import { markLibraryUsed, sortByLibraryUsage, useLibraryUsageVersion } from '../library/libraryDiscovery'
import { filterSkillLibraryItems, type SkillLibraryCategory } from '../library/libraryAdapters'
import { LibraryDiscoveryToolbar } from '../library/LibraryDiscoveryToolbar'

type Source = 'mine' | 'builtin'

const SOURCE_OPTIONS: { value: Source; labelKey: 'libraries.skill.source.mine' | 'libraries.skill.source.builtin' }[] = [
  { value: 'mine', labelKey: 'libraries.skill.source.mine' },
  { value: 'builtin', labelKey: 'libraries.skill.source.builtin' },
]

const SKILL_AUTHOR_KEY = 'skill-author'

type SkillLibraryContentProps = {
  active: boolean
  compact?: boolean
  showHeader?: boolean
  onClose?: () => void
  className?: string
}

export function SkillLibraryContent({
  active,
  compact = false,
  showHeader = true,
  onClose,
  className,
}: SkillLibraryContentProps): JSX.Element {
  const { t } = useTranslation()
  const [source, setSource] = React.useState<Source>('mine')
  const [category, setCategory] = React.useState<SkillLibraryCategory>('all')
  const [query, setQuery] = React.useState('')
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const usageVersion = useLibraryUsageVersion()

  const { items, available, remove, importPackage, exportPackage } = useWorkbenchSkills(active)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const setCreationActiveSkill = useWorkbenchStore((s) => s.setCreationActiveSkill)

  const sortedItems = React.useMemo(
    () => {
      // The usage hook is the same-window invalidation signal for recency.
      void usageVersion
      return sortByLibraryUsage(items, 'skill', (skill) => skill.directoryName)
    },
    [items, usageVersion],
  )
  const visible = React.useMemo(() => {
    return filterSkillLibraryItems(sortedItems, { source, category, query })
  }, [category, query, source, sortedItems])

  React.useEffect(() => {
    if (!active || !onClose) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onClose])

  // 在创作区锁定一个技能并切到创作区（与 ActiveSkillChip 的 onSelect 同口径）。
  const gotoCreationWith = React.useCallback(
    (skill: { key: string; name: string } | null) => {
      setCreationActiveSkill(skill)
      setWorkspaceMode('creation')
      onClose?.()
    },
    [setCreationActiveSkill, setWorkspaceMode, onClose],
  )

  const handleUse = React.useCallback(
    (skill: SkillListItemDto) => {
      gotoCreationWith({ key: skill.name, name: skill.label })
      markLibraryUsed('skill', skill.directoryName)
    },
    [gotoCreationWith],
  )

  const handleNewWithAi = React.useCallback(() => gotoCreationWith({ key: SKILL_AUTHOR_KEY, name: t('libraries.skill.authorName') }), [gotoCreationWith, t])

  // 导出：技能包对象 → JSON Blob → 浏览器下载，不弹系统对话框。
  const handleExport = React.useCallback(
    (skill: SkillListItemDto) => {
      const pkg = exportPackage(skill.directoryName)
      if (!pkg) {
        showInfoToast(t('libraries.skill.exportNotFound'))
        return
      }
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${skill.directoryName}.nomiskill.json`
      a.click()
      URL.revokeObjectURL(url)
    },
    [exportPackage, t],
  )

  // 删除可撤销：删前先把包抓在手里，撤销 = 重新导入（落回用户目录，目录名冲突会自动避让）。
  const handleDelete = React.useCallback(
    (skill: SkillListItemDto) => {
      const snapshot = exportPackage(skill.directoryName)
      const res = remove(skill.directoryName)
      if (!res.ok) {
        showInfoToast(res.error ?? t('libraries.skill.deleteFailed'))
        return
      }
      showUndoToast({
        message: t('libraries.skill.deleted', { name: skill.label }),
        onUndo: () => {
          if (snapshot) importPackage(snapshot)
        },
      })
    },
    [exportPackage, remove, importPackage, t],
  )

  // 导入：渲染层把 SKILL.md / zip / .nomiskill.json 归一成 {dirName, files} → 落用户目录
  // （版本戳与真正的安全校验都在主进程 skillPackage.ts，渲染层的判断一律不可信）。
  const handleImportFile = React.useCallback(
    async (file: File) => {
      const parsed = await parseSkillImportFile(file)
      if (!parsed.ok) {
        showInfoToast(t(`libraries.skill.importReason.${parsed.reason}`))
        return
      }
      const res = importPackage(parsed.payload)
      if (!res.ok) {
        showInfoToast(t('libraries.skill.importFailed', { message: res.error ?? t('libraries.skill.unknownError') }))
        return
      }
      const name = res.skillName ?? t('libraries.skill.newSkill')
      // 跳过的文件如实报数，不静默丢（二进制/超深路径进不了知识层包）。
      showInfoToast(parsed.skipped.length
        ? t('libraries.skill.importedWithSkips', { name, count: parsed.skipped.length })
        : t('libraries.skill.imported', { name }))
    },
    [importPackage, t],
  )

  const showNewTile = source === 'mine' && category === 'all' && !query.trim()

  const sourceTabs = (
    <div
      className={cn('inline-flex bg-nomi-ink-05 rounded-full p-0.5', compact ? 'w-full' : 'shrink-0')}
      role="tablist"
      aria-label={t('libraries.skill.sourceAria')}
    >
      {SOURCE_OPTIONS.map((option) => {
        const activeOption = source === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={activeOption}
            className={cn(
              'rounded-full text-caption cursor-pointer border-0 bg-transparent whitespace-nowrap',
              'transition-[background,color] duration-[var(--nomi-transition-fast)]',
              compact ? 'min-w-0 flex-1 px-2 py-1' : 'px-3 py-1',
              activeOption
                ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm'
                : 'text-nomi-ink-60 hover:text-nomi-ink',
            )}
            onClick={() => setSource(option.value)}
          >
            {t(option.labelKey)}
          </button>
        )
      })}
    </div>
  )

  const categoryTabs = (
    <NomiSegmented
      value={category}
      onChange={(value) => setCategory(value as SkillLibraryCategory)}
      ariaLabel={t('libraries.skill.categoryAria')}
      density="compact"
      className={cn(compact ? 'w-full' : 'shrink-0')}
      options={[
        { value: 'all', label: t('libraries.skill.category.all') },
        { value: 'playbook', label: t('libraries.skill.category.playbook') },
        { value: 'assistant', label: t('libraries.skill.category.assistant') },
      ]}
    />
  )

  const importButton = (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      className={cn(
        'shrink-0 inline-flex items-center justify-center gap-1.5 h-8 rounded-full cursor-pointer',
        'border border-nomi-line bg-transparent text-nomi-ink-80 text-caption hover:bg-nomi-ink-05 transition-colors',
        compact ? 'px-2' : 'px-3',
      )}
    >
      <IconUpload size={14} stroke={1.7} />
      {t('libraries.skill.importFile')}
    </button>
  )

  const newWithAiButton = (
    <button
      type="button"
      onClick={handleNewWithAi}
      className={cn(
        'shrink-0 inline-flex items-center justify-center gap-1.5 h-8 rounded-full cursor-pointer border-0',
        'bg-nomi-ink text-nomi-paper text-caption hover:bg-nomi-accent transition-colors',
        compact ? 'px-2' : 'px-3.5',
      )}
    >
      <IconWand size={14} stroke={1.7} />
      {compact ? t('libraries.skill.createCompact') : t('libraries.skill.create')}
    </button>
  )

  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={80}>
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
        {/* 头部 */}
        {showHeader ? (
          <div className={cn('flex items-center gap-2 px-5 pt-4 pb-3 border-b border-nomi-line')}>
            <IconBooks size={18} stroke={1.6} className={cn('text-nomi-accent')} />
            <b className={cn('text-title font-bold text-nomi-ink')}>{t('libraries.skill.title')}</b>
            <NomiWordmark fontSize={13} className={cn('text-nomi-ink-40')} />
            <span className={cn('text-caption text-nomi-ink-40')}>· {visible.length}</span>
            <span className={cn('flex-1')} />
            {onClose ? (
              <button
                type="button"
                className={cn('w-7 h-7 grid place-items-center rounded-nomi-sm cursor-pointer border-0 bg-transparent', 'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05')}
                aria-label={t('libraries.skill.closeAria')}
                onClick={onClose}
              >
                <IconX size={16} stroke={2} />
              </button>
            ) : null}
          </div>
        ) : null}

        {/* 工具行：来源/类型留在技能库自己的上下文，搜索与低频动作共用发现条布局。 */}
        <LibraryDiscoveryToolbar
          className={compact ? 'px-3 py-3' : 'px-5 py-2.5'}
          compact={compact}
          query={query}
          onQueryChange={setQuery}
          placeholder={t('libraries.skill.searchPlaceholder')}
          ariaLabel={t('libraries.skill.searchAria')}
          leading={<>{sourceTabs}{categoryTabs}</>}
          trailing={compact ? (
            <div className={cn('grid w-full grid-cols-2 gap-2')}>
              {importButton}
              {newWithAiButton}
            </div>
          ) : <>{importButton}{newWithAiButton}</>}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.zip,.json,.nomiskill"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImportFile(file)
            e.target.value = ''
          }}
        />

        {/* 网格 */}
        <div className={cn('flex-1 overflow-y-auto', compact ? 'px-3 pb-3' : 'px-5 pb-5')}>
          {!visible.length && !showNewTile ? (
            <DesignEmptyState
              title={query.trim() || category !== 'all' ? t('libraries.skill.noMatch') : source === 'mine' ? t('libraries.skill.noMine') : t('libraries.skill.noBuiltin')}
              description={
                query.trim() || category !== 'all'
                  ? t('libraries.skill.tryAnotherSearch')
                  : source === 'mine'
                    ? t('libraries.skill.mineEmptyHint')
                    : ''
              }
            />
          ) : (
            <div
              className={cn('grid gap-3')}
              style={{ gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(220px, 1fr))' }}
            >
              {showNewTile ? (
                <button
                  type="button"
                  onClick={handleNewWithAi}
                  className={cn('flex flex-col items-center justify-center gap-1.5 w-full min-h-[120px] cursor-pointer', 'rounded-nomi border border-dashed border-nomi-line bg-transparent text-nomi-ink-40', 'hover:border-nomi-accent hover:text-nomi-accent transition-colors')}
                >
                  <IconWand size={22} stroke={1.6} />
                  <span className={cn('text-caption')}>{t('libraries.skill.createOne')}</span>
                </button>
              ) : null}
              {visible.map((skill) => (
                <SkillCard
                  key={skill.directoryName}
                  skill={skill}
                  available={available}
                  onUse={handleUse}
                  onExport={handleExport}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

// 注：这里原本还有一个 SkillLibraryPanel（960px 全屏 modal 壳）。它只监听 nomi-open-skill-library，
// 全仓零 dispatch —— 永远打不开，用户从没见过（活的是侧栏用的 Content 版）。
// 2026-08-02 §1.5 清死码时删除，并焊了 src/customEventWiring.test.ts 防同类复发。
