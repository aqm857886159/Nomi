import React from 'react'
import { useTranslation } from 'react-i18next'
import type { SkillListItemDto } from '../../api/skillApi'
import { filterPrompts, type LibraryPrompt } from '../../api/promptLibraryApi'
import { libraryGroup } from '../../library/libraryGroups'
import type { LibraryPickerHandle, LibraryPickerKeyEvent } from '../../library/LibraryPicker'
import { promptDisplayTitle } from '../../promptLibrary/promptDisplay'
import { skillDisplayTitle } from '../../skillLibrary/skillDisplay'
import type { V4CommandRow } from '../v4/AgentPanelV4Composer'
import type { ComposerPopover } from '../v4/agentPanelV4Types'

/**
 * 判断草稿是否处于「/」技能弹层触发态：行首 `/` 且不含换行与 `@` 引用标记。
 * 与 `@` 素材引用互不打架：`@` 开头或句中 `/@` 交回 `@` 补全，绝不抢弹层。
 */
export function parseAgentSlashQuery(draft: string): string | null {
  const match = /^\/([^\n@]*)$/.exec(draft)
  return match ? match[1] : null
}

/**
 * 构造 Agent「/」弹层行（拍板图 LibraryPointers）：
 * - 分类只分「全部 / 技能 / 提示词」（效果按 Q1 归提示词，作为提示词下的分组）；
 * - 分组头带「技能 · 分组」/「提示词 · 分组」；
 * - 行内只印界面语言标题与一句描述，不再印内部 `/id`；
 * - 封面与暗色示意插画处理（Q8）和技能库 / 提示词库同源同脸。
 */
export function buildAgentSlashRows(input: {
  skills: readonly SkillListItemDto[]
  promptItems: readonly LibraryPrompt[]
  userPromptItems: readonly LibraryPrompt[]
  query: string
  language: string
  sectionSkills: string
  sectionPrompts: string
  mineLabel: string
  activeSkillKey: string | null
  selectedPromptId: string | null
}): readonly V4CommandRow[] {
  const query = input.query.trim()
  const lowered = query.toLowerCase()
  const locale = input.language.startsWith('zh') ? 'zh-CN' : 'en'

  const skillRows: V4CommandRow[] = input.skills
    .filter((skill) => {
      if (skill.curation?.kind === 'effect') return false
      if (!lowered) return true
      const title = skillDisplayTitle(skill, input.language)
      const desc = skill.curation?.summary[locale] ?? skill.description ?? ''
      return `${title} ${skill.name} ${desc}`.toLowerCase().includes(lowered)
    })
    // 自己导进来的排在内置前面，避免用户刚导入的技能被压在列表底部。
    .sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'user' ? -1 : 1))
    .map((skill) => {
      const rawGroup = libraryGroup(skill, input.language)
      const group = rawGroup
        ? { id: rawGroup.id, label: `${input.sectionSkills} · ${rawGroup.label}` }
        : skill.origin === 'user'
          ? { id: 'mine', label: `${input.sectionSkills} · ${input.mineLabel}` }
          : { id: 'other', label: input.sectionSkills }
      return {
        id: `skill:${skill.name}`,
        group,
        name: skillDisplayTitle(skill, input.language),
        desc: skill.curation?.summary[locale] ?? skill.description ?? skill.stageLabels.join(' · '),
        cover: skill.cover,
        preview: skill.preview,
        illustration: skill.curation?.preview?.provenance === 'illustration',
        section: input.sectionSkills,
        selected: input.activeSkillKey === skill.name,
      }
    })

  // 提示词与效果统一归「提示词」段（Q1），按各自分组展现「提示词 · 分组」。
  const promptRows: V4CommandRow[] = [...input.promptItems, ...input.userPromptItems]
    .filter((prompt) => filterPrompts([prompt], 'all', query).length > 0)
    .map((prompt) => {
      const rawGroup = libraryGroup(prompt, input.language)
      const group = rawGroup
        ? { id: rawGroup.id, label: `${input.sectionPrompts} · ${rawGroup.label}` }
        : prompt.origin === 'user'
          ? { id: 'mine', label: `${input.sectionPrompts} · ${input.mineLabel}` }
          : { id: 'other', label: input.sectionPrompts }
      return {
        id: `prompt:${prompt.id}`,
        group,
        name: promptDisplayTitle(prompt),
        desc: prompt.prompt,
        section: input.sectionPrompts,
        preview: prompt.mediaUrl ? { url: prompt.mediaUrl, type: prompt.mediaType } : undefined,
        ...(prompt.mediaType === 'image' && prompt.mediaUrl ? { cover: prompt.mediaUrl } : {}),
        illustration: prompt.curation?.preview?.provenance === 'illustration',
        selected: input.selectedPromptId === prompt.id,
      }
    })

  return Object.freeze([...skillRows, ...promptRows])
}

export function useAgentSlashMenu(input: {
  popover: ComposerPopover | null
  setPopover: React.Dispatch<React.SetStateAction<ComposerPopover | null>>
  skills: readonly SkillListItemDto[]
  promptItems: readonly LibraryPrompt[]
  userPromptItems: readonly LibraryPrompt[]
  activeSkillKey: string | null
  selectedPromptId: string | null
  getDraft: () => string
  clearSlashDraft: () => void
  focusComposer: () => void
  onSelectSkill: (key: string) => void
  onSelectPrompt: (prompt: LibraryPrompt | null) => void
}) {
  const { t, i18n } = useTranslation()
  const [commandQuery, setCommandQuery] = React.useState('')
  const [openedBySlash, setOpenedBySlash] = React.useState(false)
  const slashDismissedDraftRef = React.useRef<string | null>(null)
  const pickerRef = React.useRef<LibraryPickerHandle>(null)

  const categories = React.useMemo(
    () => [t('agentPanelV4.skillAll'), t('agentPanelV4.sectionSkills'), t('agentPanelV4.sectionPrompts')],
    [t],
  )

  const commandRows = React.useMemo(
    () => buildAgentSlashRows({
      skills: input.skills,
      promptItems: input.promptItems,
      userPromptItems: input.userPromptItems,
      query: commandQuery,
      language: i18n.language,
      sectionSkills: t('agentPanelV4.sectionSkills'),
      sectionPrompts: t('agentPanelV4.sectionPrompts'),
      mineLabel: t('libraries.layout.mine'),
      activeSkillKey: input.activeSkillKey,
      selectedPromptId: input.selectedPromptId,
    }),
    [
      commandQuery,
      i18n.language,
      input.activeSkillKey,
      input.promptItems,
      input.selectedPromptId,
      input.skills,
      input.userPromptItems,
      t,
    ],
  )

  const dismissPopover = React.useCallback(() => {
    if (openedBySlash) slashDismissedDraftRef.current = input.getDraft()
    setOpenedBySlash(false)
    input.setPopover(null)
  }, [input, openedBySlash])

  const togglePopover = React.useCallback((next: ComposerPopover) => {
    if (next === 'skill') {
      slashDismissedDraftRef.current = null
      setOpenedBySlash(false)
      setCommandQuery('')
    }
    input.setPopover((current) => (current === next ? null : next))
  }, [input])

  const handleDraftWrite = React.useCallback((nextDraft: string) => {
    const slashQuery = parseAgentSlashQuery(nextDraft)
    if (slashQuery !== null) {
      if (slashDismissedDraftRef.current === nextDraft) return
      slashDismissedDraftRef.current = null
      setOpenedBySlash(true)
      setCommandQuery(slashQuery)
      input.setPopover('skill')
      return
    }
    slashDismissedDraftRef.current = null
    if (openedBySlash && input.popover === 'skill') {
      setOpenedBySlash(false)
      setCommandQuery('')
      input.setPopover(null)
    }
  }, [input, openedBySlash])

  const selectRow = React.useCallback((row: V4CommandRow) => {
    if (row.id.startsWith('skill:')) {
      input.onSelectSkill(row.id.slice('skill:'.length))
    } else {
      const id = row.id.slice('prompt:'.length)
      const prompt = [...input.promptItems, ...input.userPromptItems].find((item) => item.id === id)
      input.onSelectPrompt(prompt ?? null)
    }
    const wasSlash = openedBySlash
    setOpenedBySlash(false)
    setCommandQuery('')
    slashDismissedDraftRef.current = null
    input.setPopover(null)
    if (wasSlash) {
      input.clearSlashDraft()
      input.focusComposer()
    }
  }, [input, openedBySlash])

  const handleComposerKeyDown = React.useCallback((event: LibraryPickerKeyEvent): boolean => {
    if (input.popover !== 'skill') return false
    return pickerRef.current?.handleKeyDown(event) ?? false
  }, [input.popover])

  return {
    categories,
    commandQuery,
    setCommandQuery,
    commandRows,
    openedBySlash,
    pickerRef,
    dismissPopover,
    togglePopover,
    handleDraftWrite,
    selectRow,
    handleComposerKeyDown,
  }
}
