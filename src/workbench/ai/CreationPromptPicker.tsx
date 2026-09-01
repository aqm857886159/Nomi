// 创作助手「本轮用什么」选择器（用户 2026-08-18 拍板：挪到 composer 发送键左边）。
//
// 这里同时装着两种**不同**的东西，过去混在一起没人讲破，所以分组时把话说清：
//   · 提示词 = 一段文字，决定它**怎么说话**（内置 7 个 + 用户自建 N 个），无工具无阶段；
//   · 流程包 = 目录包（SKILL.md + skill.json），带工具白名单和阶段编排，决定它**怎么干活**。
//
// 根因备忘（2026-08-18）：本组件的前身 ActiveSkillChip 把列表**手写死**了——只列「自动」和
// 一个硬编码的 onModeChange('assets')，于是 CREATION_AI_MODES 的 7 个模式里有 5 个
// （写故事/写剧本/写分镜文字稿/Seedance 提示词/审校优化）在 UI 上根本不存在：提示词写了、
// 设置里能编辑、就是**调不起来**。现在整组提示词一律从 listCreationAiModes() derive，
// 新增模式自动出现，不会再有搁浅的模式（结构测试钉死，见 creationPromptPicker.structure.test.ts）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconChevronDown, IconMovie, IconPlus, IconSettings, IconSparkles, IconWand } from '@tabler/icons-react'
import { ConversationHistoryPopover } from './ConversationHistoryPopover'
import { listCreationAiModes } from '../creation/creationAiModes'
import { useSystemPromptSnapshot } from '../creation/useSystemPromptOverrides'
import {
  getAvailableSkillProviders,
  listWorkbenchSkills,
  skillCapabilityFor,
  type SkillListItemDto,
  type SkillProviderKind,
} from '../api/skillApi'

type ActiveSkill = { key: string; name: string }

// 「让 AI 帮我写技能」激活的元 skill：用户贴/说他的 skill，创作 Agent 用它转写成 Nomi 技能。
// key 以 workbench.creation. 开头 → 路由到 document 工具组（拿到 author_skill）。
const SKILL_AUTHOR_KEY = 'workbench.creation.skill-author'

function openModelCatalog(): void {
  window.dispatchEvent(new Event('nomi-open-model-catalog'))
}

function openPromptSettings(): void {
  window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'ai' } }))
}

export default function CreationPromptPicker({
  activeSkill,
  modeId,
  onModeChange,
  onSelect,
}: {
  activeSkill: ActiveSkill | null
  /** 当前选中的提示词 id（内置模式 id 或 custom:<uuid>）。 */
  modeId: string
  onModeChange: (modeId: string) => void
  onSelect: (skill: ActiveSkill | null) => void
}): JSX.Element {
  const { t } = useTranslation()
  const providerName = (kind: SkillProviderKind): string =>
    t(`libraries.skill.provider.${kind}` as 'libraries.skill.provider.text')
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const [open, setOpen] = React.useState(false)
  const [skills, setSkills] = React.useState<SkillListItemDto[]>([])
  const [available, setAvailable] = React.useState<ReadonlySet<SkillProviderKind>>(new Set())
  // 订阅覆盖/自定义快照：设置页新建或改名后，这个列表要立刻跟上（否则得重开面板才看得到）。
  useSystemPromptSnapshot()
  const modes = listCreationAiModes()
  const builtinModes = modes.filter((mode) => !mode.custom)
  const customModes = modes.filter((mode) => mode.custom)
  const localizedMode = (mode: (typeof modes)[number]) => {
    if (mode.custom) return mode
    const key = `creationAi.mode.${mode.id}` as const
    return {
      ...mode,
      label: t(`${key}.label`),
      shortLabel: t(`${key}.short`),
      title: t(`${key}.title`),
      description: t(`${key}.description`),
    }
  }

  const refresh = React.useCallback(() => {
    try {
      setSkills(listWorkbenchSkills())
    } catch {
      setSkills([])
    }
    getAvailableSkillProviders()
      .then(setAvailable)
      .catch(() => setAvailable(new Set()))
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const activeItem = activeSkill ? (skills.find((s) => s.name === activeSkill.key) ?? null) : null
  const activeMissing = activeItem ? skillCapabilityFor(activeItem, available).missing : []
  // chip 标签跟当前选择走（过去恒显「通用助手」，读起来像个静态徽标而不是选择器）。
  const activeMode = localizedMode(modes.find((mode) => mode.id === modeId) ?? modes[0])
  const chipLabel = activeSkill ? activeSkill.name : activeMode.shortLabel
  const chipActive = Boolean(activeSkill) || modeId !== 'general'

  const pickMode = (nextModeId: string): void => {
    onSelect(null)
    onModeChange(nextModeId)
    setOpen(false)
  }

  const rowClass = (selected: boolean): string =>
    [
      'flex w-full items-start gap-2 rounded-nomi-sm px-2.5 py-2 text-left transition-colors',
      'duration-[var(--nomi-transition-fast)]',
      selected ? 'bg-nomi-accent-soft text-nomi-accent' : 'hover:bg-nomi-ink-05',
    ].join(' ')

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t('libraries.skill.currentHint')}
        aria-label={t('libraries.skill.pickerAria')}
        data-creation-prompt-picker="true"
        className={[
          'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-caption font-medium shrink min-w-0 transition-colors',
          'duration-[var(--nomi-transition-fast)]',
          chipActive ? 'bg-nomi-accent-soft text-nomi-accent' : 'bg-nomi-ink-05 text-nomi-ink-80 hover:bg-nomi-ink-10',
        ].join(' ')}
      >
        {activeSkill ? (
          <IconMovie size={14} stroke={1.5} className="shrink-0" />
        ) : (
          <IconSparkles size={14} stroke={1.5} className="shrink-0" />
        )}
        <span className="truncate">{chipLabel}</span>
        {activeMissing.length > 0 && (
          <IconAlertTriangle size={13} stroke={1.8} className="shrink-0 text-workbench-danger" />
        )}
        <IconChevronDown size={13} stroke={1.6} className="shrink-0 opacity-60" />
      </button>

      {open && (
        <ConversationHistoryPopover anchorRef={anchorRef} onClose={() => setOpen(false)} align="left">
          <div className="w-[284px] max-h-[min(520px,70vh)] overflow-y-auto rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-lg p-1.5 text-body-sm text-nomi-ink">
            {/* ── 提示词（内置）：全量 derive，不再手写条目 ── */}
            <div className="px-2 pt-1 pb-1.5 text-micro text-nomi-ink-40">{t('libraries.skill.groupPrompts')}</div>
            {builtinModes.map((mode) => {
              const displayMode = localizedMode(mode)
              const selected = !activeSkill && modeId === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => pickMode(mode.id)}
                  data-prompt-option={mode.id}
                  className={rowClass(selected)}
                >
                  <IconSparkles size={16} stroke={1.5} className="mt-0.5 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium">{displayMode.title}</span>
                    {displayMode.description ? (
                      <span className="block text-micro text-nomi-ink-60">{displayMode.description}</span>
                    ) : null}
                  </span>
                  {selected && <IconCheck size={15} stroke={1.8} className="mt-0.5 shrink-0" />}
                </button>
              )
            })}

            {/* ── 我的：用户自建；空列表时只留「新建」入口，不留空标题 ── */}
            <div className="my-1 border-t border-nomi-line-soft" />
            <div className="px-2 pt-1 pb-1.5 text-micro text-nomi-ink-40">{t('libraries.skill.groupMine')}</div>
            {customModes.map((mode) => {
              const selected = !activeSkill && modeId === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => pickMode(mode.id)}
                  data-prompt-option={mode.id}
                  className={rowClass(selected)}
                >
                  <IconWand size={16} stroke={1.5} className="mt-0.5 shrink-0" />
                  <span className="flex-1 min-w-0 font-medium truncate">{mode.title}</span>
                  {selected && <IconCheck size={15} stroke={1.8} className="mt-0.5 shrink-0" />}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => {
                openPromptSettings()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-nomi-sm px-2.5 py-2 text-left text-nomi-accent hover:bg-nomi-accent-soft transition-colors duration-[var(--nomi-transition-fast)]"
            >
              <IconPlus size={16} stroke={1.8} className="shrink-0" />
              <span className="flex-1 min-w-0 font-medium">{t('libraries.skill.newPrompt')}</span>
            </button>

            {/* ── 流程包：既有 playbook 技能 + AI 代写入口 ── */}
            <div className="my-1 border-t border-nomi-line-soft" />
            <div className="px-2 pt-1 pb-1.5 text-micro text-nomi-ink-40">{t('libraries.skill.groupPlaybooks')}</div>
            {skills.map((skill) => {
              const cap = skillCapabilityFor(skill, available)
              const selected = activeSkill?.key === skill.name
              return (
                <button
                  key={skill.directoryName}
                  type="button"
                  onClick={() => {
                    onSelect({ key: skill.name, name: skill.label })
                    setOpen(false)
                  }}
                  className={rowClass(selected)}
                >
                  <IconMovie size={16} stroke={1.5} className="mt-0.5 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium truncate">{skill.label}</span>
                      <span className="shrink-0 rounded-full bg-nomi-ink-05 px-1.5 text-micro text-nomi-ink-60">
                        {t('libraries.skill.playbookStages', { count: skill.stageLabels.length })}
                      </span>
                    </span>
                    {skill.author && <span className="block text-micro text-nomi-ink-60">{skill.author}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      {skill.neededProviders.map((kind) => {
                        const ok = !cap.missing.includes(kind)
                        return (
                          <span
                            key={kind}
                            className={[
                              'inline-flex items-center gap-0.5 text-micro',
                              ok ? 'text-workbench-success' : 'text-nomi-ink-40',
                            ].join(' ')}
                          >
                            {ok ? <IconCheck size={11} stroke={2} /> : <IconAlertTriangle size={11} stroke={2} />}
                            {providerName(kind)}
                          </span>
                        )
                      })}
                    </span>
                  </span>
                  {selected && <IconCheck size={15} stroke={1.8} className="mt-0.5 shrink-0" />}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => {
                onSelect({ key: SKILL_AUTHOR_KEY, name: t('libraries.skill.authorName') })
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-nomi-sm px-2.5 py-2 text-left text-nomi-accent hover:bg-nomi-accent-soft transition-colors duration-[var(--nomi-transition-fast)]"
            >
              <IconWand size={16} stroke={1.5} className="shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block font-medium">{t('libraries.skill.authorAction')}</span>
                <span className="block text-micro text-nomi-ink-60">{t('libraries.skill.authorDescription')}</span>
              </span>
            </button>

            {activeMissing.length > 0 && (
              <div className="mx-1 mt-1.5 flex items-center justify-between gap-2 rounded-nomi-sm bg-nomi-ink-05 px-2.5 py-2">
                <span className="min-w-0 text-micro text-nomi-ink-80">
                  {t('libraries.skill.missingModels', {
                    providers: activeMissing.map(providerName).join(t('assetLibrary.listSeparator')),
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    openModelCatalog()
                    setOpen(false)
                  }}
                  className="shrink-0 rounded-full bg-nomi-ink px-2.5 py-1 text-micro text-nomi-paper hover:bg-nomi-accent transition-colors duration-[var(--nomi-transition-fast)]"
                >
                  {t('libraries.skill.connect')}
                </button>
              </div>
            )}

            <div className="my-1 border-t border-nomi-line-soft" />
            <button
              type="button"
              onClick={() => {
                openPromptSettings()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-nomi-sm px-2.5 py-2 text-left text-nomi-ink-60 hover:bg-nomi-ink-05 transition-colors duration-[var(--nomi-transition-fast)]"
            >
              <IconSettings size={15} stroke={1.5} className="shrink-0" />
              <span className="flex-1 min-w-0 text-micro">{t('libraries.skill.editInSettings')}</span>
            </button>
          </div>
        </ConversationHistoryPopover>
      )}
    </>
  )
}
