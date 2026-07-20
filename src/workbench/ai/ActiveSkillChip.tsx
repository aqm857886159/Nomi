// active-skill chip：创作助手 header 上的「当前技能」徽标 + 选择 popover + 能力清单 + 导入。
// 自动路由（按 description 选）暂未接，先做「自动（跟模式）+ 手动锁定」。prop 驱动，未来画布助手可复用。
// token-only：颜色/圆角/字号全走设计系统 token（孤儿 CSS 的旧类名挂不上，复制其 token 值）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconChevronDown, IconMovie, IconSparkles, IconWand } from '@tabler/icons-react'
import { ConversationHistoryPopover } from './ConversationHistoryPopover'
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

export default function ActiveSkillChip({
  activeSkill,
  autoLabel,
  onSelect,
}: {
  activeSkill: ActiveSkill | null
  autoLabel: string
  onSelect: (skill: ActiveSkill | null) => void
}): JSX.Element {
  const { t } = useTranslation()
  const providerName = (kind: SkillProviderKind): string =>
    t(`libraries.skill.provider.${kind}` as 'libraries.skill.provider.text')
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const [open, setOpen] = React.useState(false)
  const [skills, setSkills] = React.useState<SkillListItemDto[]>([])
  const [available, setAvailable] = React.useState<ReadonlySet<SkillProviderKind>>(new Set())

  const refresh = React.useCallback(() => {
    try {
      setSkills(listWorkbenchSkills().filter((s) => s.isPlaybook))
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

  const chipActive = Boolean(activeSkill)
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t('libraries.skill.currentHint')}
        className={[
          'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-caption font-medium shrink min-w-0 transition-colors',
          'duration-[var(--nomi-transition-fast)]',
          chipActive ? 'bg-nomi-accent-soft text-nomi-accent' : 'bg-nomi-ink-05 text-nomi-ink-80 hover:bg-nomi-ink-10',
        ].join(' ')}
      >
        {chipActive ? (
          <IconMovie size={14} stroke={1.5} className="shrink-0" />
        ) : (
          <IconSparkles size={14} stroke={1.5} className="shrink-0" />
        )}
        <span className="truncate">{activeSkill ? activeSkill.name : autoLabel}</span>
        {activeMissing.length > 0 && (
          <IconAlertTriangle size={13} stroke={1.8} className="shrink-0 text-workbench-danger" />
        )}
        <IconChevronDown size={13} stroke={1.6} className="shrink-0 opacity-60" />
      </button>

      {open && (
        <ConversationHistoryPopover anchorRef={anchorRef} onClose={() => setOpen(false)}>
          <div className="w-[284px] rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-lg p-1.5 text-body-sm text-nomi-ink">
            <div className="px-2 pt-1 pb-2 text-caption text-nomi-ink-60">{t('libraries.skill.choose')}</div>

            <button
              type="button"
              onClick={() => {
                onSelect(null)
                setOpen(false)
              }}
              className={[
                'flex w-full items-center gap-2 rounded-nomi-sm px-2.5 py-2 text-left transition-colors',
                'duration-[var(--nomi-transition-fast)]',
                activeSkill ? 'hover:bg-nomi-ink-05' : 'bg-nomi-accent-soft text-nomi-accent',
              ].join(' ')}
            >
              <IconWand size={16} stroke={1.5} className="shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block font-medium">{t('libraries.skill.auto')}</span>
                <span className="block text-micro text-nomi-ink-60">
                  {t('libraries.skill.followsMode', { mode: autoLabel })}
                </span>
              </span>
              {!activeSkill && <IconCheck size={15} stroke={1.8} className="shrink-0" />}
            </button>

            {skills.length > 0 && <div className="my-1 border-t border-nomi-line-soft" />}

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
                  className={[
                    'flex w-full items-start gap-2 rounded-nomi-sm px-2.5 py-2 text-left transition-colors',
                    'duration-[var(--nomi-transition-fast)]',
                    selected ? 'bg-nomi-accent-soft text-nomi-accent' : 'hover:bg-nomi-ink-05',
                  ].join(' ')}
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
          </div>
        </ConversationHistoryPopover>
      )}
    </>
  )
}
