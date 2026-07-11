/**
 * 技能库面板。技能在 App 里唯一的「家」：浏览（我的技能 / Nomi 内置）、搜索、导入文件、用 AI 新建、
 * 导出、删除、一键在创作区使用。设计对齐提示词库（PromptLibraryPanel）：居中模态 + 来源标签 + 卡片网格。
 * 导入/导出纯走渲染层（FileReader 读包 / Blob 下载），不加系统对话框桥；创建只走 AI（复用创作区
 * 「让 AI 帮我写技能」），不做手填 manifest 表单（docs/plan/2026-06-23-skill-library-hub.md）。
 */
import React from 'react'
import { Portal } from '@mantine/core'
import { IconBooks, IconUpload, IconWand, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignEmptyState, DesignSearchInput, NomiWordmark, TooltipProvider } from '../../design'
import { showInfoToast } from '../../utils/showInfoToast'
import { showUndoToast } from '../../utils/showUndoToast'
import { useWorkbenchStore } from '../workbenchStore'
import type { SkillListItemDto } from '../api/skillApi'
import { useWorkbenchSkills } from './useWorkbenchSkills'
import { SkillCard } from './SkillCard'

type Source = 'mine' | 'builtin'

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: 'mine', label: '我的技能' },
  { value: 'builtin', label: 'Nomi 内置' },
]

// 「让 AI 帮我写技能」激活的元 skill（与 ActiveSkillChip 的 SKILL_AUTHOR 同口径）。
const SKILL_AUTHOR = { key: 'workbench.creation.skill-author', name: 'AI 写技能' }

type Props = {
  opened: boolean
  onClose: () => void
}

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
  const [source, setSource] = React.useState<Source>('mine')
  const [query, setQuery] = React.useState('')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const { items, available, remove, importPackage, exportPackage } = useWorkbenchSkills(active)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const setCreationActiveSkill = useWorkbenchStore((s) => s.setCreationActiveSkill)

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((s) => {
      if (source === 'mine' ? s.origin !== 'user' : s.origin !== 'builtin') return false
      if (!q) return true
      return s.label.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)
    })
  }, [items, source, query])

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
    (skill: SkillListItemDto) => gotoCreationWith({ key: skill.name, name: skill.label }),
    [gotoCreationWith],
  )

  const handleNewWithAi = React.useCallback(() => gotoCreationWith(SKILL_AUTHOR), [gotoCreationWith])

  // 导出：技能包对象 → JSON Blob → 浏览器下载，不弹系统对话框。
  const handleExport = React.useCallback(
    (skill: SkillListItemDto) => {
      const pkg = exportPackage(skill.directoryName)
      if (!pkg) {
        showInfoToast('导出失败：没找到这个技能')
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
    [exportPackage],
  )

  // 删除可撤销：删前先把包抓在手里，撤销 = 重新导入（落回用户目录，目录名冲突会自动避让）。
  const handleDelete = React.useCallback(
    (skill: SkillListItemDto) => {
      const snapshot = exportPackage(skill.directoryName)
      const res = remove(skill.directoryName)
      if (!res.ok) {
        showInfoToast(res.error ?? '删除失败')
        return
      }
      showUndoToast({
        message: `已删除 · ${skill.label}`,
        onUndo: () => {
          if (snapshot) importPackage(snapshot)
        },
      })
    },
    [exportPackage, remove, importPackage],
  )

  // 导入：渲染层读文件 → 解析 JSON → 落用户目录（后端校验版本/形状/路径安全）。
  const handleImportFile = React.useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(String(reader.result || ''))
        } catch {
          showInfoToast('导入失败：不是合法的技能包文件（JSON 解析失败）')
          return
        }
        const res = importPackage(parsed)
        showInfoToast(res.ok ? `已导入 · ${res.skillName ?? '新技能'}` : `导入失败：${res.error ?? '未知错误'}`)
      }
      reader.onerror = () => showInfoToast('导入失败：读不出这个文件')
      reader.readAsText(file)
    },
    [importPackage],
  )

  const showNewTile = source === 'mine' && !query.trim()

  const sourceTabs = (
    <div
      className={cn('inline-flex bg-nomi-ink-05 rounded-full p-0.5', compact ? 'w-full' : 'shrink-0')}
      role="tablist"
      aria-label="技能来源"
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
            {option.label}
          </button>
        )
      })}
    </div>
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
      导入文件
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
      {compact ? 'AI 新建' : '用 AI 新建'}
    </button>
  )

  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={80}>
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
        {/* 头部 */}
        {showHeader ? (
          <div className={cn('flex items-center gap-2 px-5 pt-4 pb-3 border-b border-nomi-line')}>
            <IconBooks size={18} stroke={1.6} className={cn('text-nomi-accent')} />
            <b className={cn('text-title font-bold text-nomi-ink')}>技能库</b>
            <NomiWordmark fontSize={13} className={cn('text-nomi-ink-40')} />
            <span className={cn('text-caption text-nomi-ink-40')}>· {items.length}</span>
            <span className={cn('flex-1')} />
            {onClose ? (
              <button
                type="button"
                className={cn('w-7 h-7 grid place-items-center rounded-nomi-sm cursor-pointer border-0 bg-transparent', 'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05')}
                aria-label="关闭技能库"
                onClick={onClose}
              >
                <IconX size={16} stroke={2} />
              </button>
            ) : null}
          </div>
        ) : null}

        {/* 工具行 */}
        <div className={cn('flex gap-2', compact ? 'flex-col px-3 py-3' : 'items-center px-5 py-2.5')}>
          {sourceTabs}
          <DesignSearchInput
            className={compact ? 'w-full' : 'flex-1'}
            placeholder="搜技能…"
            ariaLabel="搜索技能"
            value={query}
            onChange={setQuery}
          />
          {compact ? (
            <div className={cn('grid grid-cols-2 gap-2')}>
              {importButton}
              {newWithAiButton}
            </div>
          ) : (
            <>
              {importButton}
              {newWithAiButton}
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.nomiskill,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImportFile(file)
              e.target.value = ''
            }}
          />
        </div>

        {/* 网格 */}
        <div className={cn('flex-1 overflow-y-auto', compact ? 'px-3 pb-3' : 'px-5 pb-5')}>
          {!visible.length && !showNewTile ? (
            <DesignEmptyState
              title={query.trim() ? '没有匹配的技能' : source === 'mine' ? '你还没有自己的技能' : '没有内置技能'}
              description={
                query.trim()
                  ? '换个搜索词试试。'
                  : source === 'mine'
                    ? '点「用 AI 新建」让 AI 帮你写一个，或「导入文件」接别人的技能包。'
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
                  <span className={cn('text-caption')}>用 AI 新建一个</span>
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

export function SkillLibraryPanel({ opened, onClose }: Props): JSX.Element | null {
  if (!opened) return null

  return (
    <Portal>
      <div
        className={cn('fixed inset-0 grid place-items-center p-6')}
        style={{ zIndex: 4000, background: 'var(--nomi-scrim)', animation: 'nomi-fade 140ms cubic-bezier(.2,.7,.3,1)' }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          role="dialog"
          aria-label="技能库"
          className={cn('w-[960px] max-w-full h-[86vh] flex flex-col overflow-hidden', 'bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-lg')}
          style={{ animation: 'nomi-panel-pop 160ms cubic-bezier(.2,.7,.3,1)' }}
        >
          <SkillLibraryContent active={opened} onClose={onClose} />
        </div>

        <style>{`
          @keyframes nomi-fade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes nomi-panel-pop { from { opacity: 0; transform: translateY(-6px) scale(0.99) } to { opacity: 1; transform: translateY(0) scale(1) } }
        `}</style>
      </div>
    </Portal>
  )
}
