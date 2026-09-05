// Agent 面板 v4 · 积木 ⑧ composer（AI Elements PromptInput + MiniMax 底栏）
//
// 底栏**逐件**照定稿 Composer 板：`[+] [模型名 ▾] ｜ [Skill] …… [权限 ▾] [↑/■]`
//   [+]      一个加号（IconPlus）= 系统文件选择器，收**任意**文件。不是回形针——
//            回形针在用户心智里是「附件」，而这个口还收技能、收选中的片段。
//   模型名   **纯文字、无 icon**（用户点名，参照 ChatCut），并管图片/视频/音频三类默认预设。
//   ｜       竖分隔：左边是「这条消息带什么」，右边是「怎么执行」。
//   Skill    IconPackage + 文字；选中后钮上一个 accent 小点，引用落成上方 chip。
//   权限     文字胶囊（参照 MiniMax「自动 ▾」），三档映射合同 approvalPolicy。
//   ↑        圆形发送；运行中变 ■ 停止，占位文案改「可继续输入，将排队发送」。
//
// **没有语音钮**——我们没有语音输入，AI Elements 的 PromptInputSpeechButton 明确不用。
//
// 高度全部由 `useComposerHeight(panelHeight, mode)` derive（定稿「上限怎么定」表），
// 组件自己不写死行数；封顶后 textarea 内部滚动，滚轮到边界不外泄（`overscroll-contain`）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import {
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconPackage,
  IconPlus,
  IconX,
} from './AgentPanelV4Icons'
import { approvalPolicyForTier, maxComposerHeight, useComposerHeight, shouldSubmitComposer } from './agentPanelV4Logic'
import type { ComposerMode, ComposerPopover, PermissionTier, V4Chip } from './agentPanelV4Types'
import { DEFAULT_PERMISSION_TIER } from './agentPanelV4Types'

function ComposerChip({ chip, removeLabel }: { chip: V4Chip; removeLabel: string }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-[5px] rounded-nomi-sm border pl-1 pr-2 text-micro',
        chip.kind === 'skill'
          ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent'
          : 'border-nomi-line text-nomi-ink-80',
      )}
      data-v4-chip={chip.kind}
    >
      {chip.kind === 'skill' ? (
        <IconPackage size={12} aria-hidden="true" />
      ) : (
        <span
          className={cn('h-3.5 w-[18px] shrink-0 rounded-sm', chip.kind === 'clip' ? 'bg-nomi-track-video' : 'bg-nomi-ink-20')}
          aria-hidden="true"
        />
      )}
      <span className="max-w-[150px] truncate">{chip.label}</span>
      <button type="button" aria-label={`${removeLabel} ${chip.label}`} className="text-nomi-ink-40">
        <IconX size={11} />
      </button>
    </span>
  )
}

export function AgentPanelV4Composer({
  panelHeight = 620,
  mode = 'idle',
  permission = DEFAULT_PERMISSION_TIER,
  chips,
  initialText = '',
  dock = false,
  skillSelected = false,
  focused = false,
}: {
  panelHeight?: number
  mode?: ComposerMode
  permission?: PermissionTier
  chips?: readonly V4Chip[]
  initialText?: string
  /** 收起坞（结果全屏）：同一个 composer 落到画面下沿，上限 6 行。 */
  dock?: boolean
  skillSelected?: boolean
  focused?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = React.useState(initialText)
  const rows = Math.max(1, value.split('\n').length)
  const chipRows = chips?.length ? 1 : 0
  const height = useComposerHeight(panelHeight, dock ? 'dock' : mode, rows, chipRows)
  // 高度是**下限 + 上限**，不是写死值：`height` 是规则算出来的自然高（一行 86px、逐行长），
  // 上限由面板高 derive。中间交给内容——附件 chip 换行时框跟着长，不会把文字压没
  // （首版把 height 当固定值，三个 chip 一换行就把 textarea 挤掉了半行）。
  const cap = maxComposerHeight(panelHeight, dock ? 'dock' : mode)
  const policy = approvalPolicyForTier(permission)
  const running = mode === 'running'
  const submit = React.useCallback(() => setValue(''), [])
  return (
    <form
      className={cn(
        'flex shrink-0 flex-col overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper',
        focused && 'border-nomi-accent shadow-[0_0_0_3px_var(--nomi-accent-soft)]',
        running && 'shadow-[0_0_0_1px_var(--nomi-accent-soft)]',
        dock && 'shadow-nomi-lg',
      )}
      style={{ minHeight: height, maxHeight: cap }}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      data-v4-block="composer"
      data-mode={mode}
      data-height={height}
      data-permission={permission}
      data-approval-mode={policy.mode}
      data-spend-policy={policy.spend}
    >
      {chips?.length ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 px-2.5 pt-2">
          {chips.map((chip) => (
            <ComposerChip key={chip.label} chip={chip} removeLabel={t('agentPanelV4.removeChip')} />
          ))}
        </div>
      ) : null}
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (
            shouldSubmitComposer({
              key: event.key,
              shiftKey: event.shiftKey,
              isComposing: event.nativeEvent.isComposing,
            })
          ) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder={running ? t('agentPanelV4.placeholderRunning') : t('agentPanelV4.placeholder')}
        aria-label={t('agentPanelV4.message')}
        rows={1}
        // 封顶后内部滚动；`overscroll-contain` 让滚轮到边界不外泄到画布 / 时间轴
        // （2026-08-13 提示词滚轮那条坑同一根因）。
        className="min-h-0 w-full flex-1 resize-none overflow-y-auto overscroll-contain bg-transparent px-3 pb-1.5 pt-2.5 text-body-sm leading-normal text-nomi-ink outline-none placeholder:text-nomi-ink-40"
      />
      <div className="flex h-10 shrink-0 items-center gap-1 px-2 pb-2 pt-1">
        <button
          type="button"
          aria-label={t('agentPanelV4.addAnyFile')}
          className="grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-80 hover:bg-nomi-ink-05"
        >
          <IconPlus size={16} />
        </button>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-nomi-sm px-2 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05"
          data-v4-control="model"
        >
          {t('agentPanelV4.model')}
          <IconChevronDown size={12} />
        </button>
        <span className="mx-0.5 h-4 w-px shrink-0 bg-nomi-line" aria-hidden="true" />
        <button
          type="button"
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-nomi-sm px-2 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05',
            skillSelected && 'bg-nomi-ink-05',
          )}
          data-v4-control="skill"
          aria-pressed={skillSelected}
        >
          <IconPackage size={14} />
          {t('agentPanelV4.skill')}
          {skillSelected ? <span className="size-1.5 rounded-pill bg-nomi-accent" aria-hidden="true" /> : null}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-nomi-sm px-2 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05"
          data-v4-control="permission"
        >
          {t(`agentPanelV4.permission.${permission}`)}
          <IconChevronDown size={12} />
        </button>
        <button
          type={running ? 'button' : 'submit'}
          aria-label={running ? t('agentPanelV4.stop') : t('agentPanelV4.send')}
          className={cn(
            'grid size-[30px] shrink-0 place-items-center rounded-pill',
            running
              ? 'border-[1.5px] border-nomi-ink bg-nomi-paper text-nomi-ink'
              : // 有东西可发才点亮（文本或已挂 chip）。画布自己两种画法都出现过——
                // 高度① 那格（专门讲空框）画的是灰钮，Flow 三板画的是深钮。
                // 取「空框不该假装能发」这一条：它是那格的**论点**，另两处只是背景。
                value || chips?.length
                ? 'bg-nomi-ink text-nomi-paper'
                : 'bg-nomi-ink-10 text-nomi-ink-40',
          )}
          data-v4-control="send"
        >
          {running ? (
            <span className="size-2.5 rounded-sm bg-nomi-ink" aria-hidden="true" />
          ) : (
            <IconArrowUp size={15} />
          )}
        </button>
      </div>
    </form>
  )
}

/** 模型弹层：四行一个层，替换现役「去选文本模型 / 去模型库添加」两级冗余。每行带**预计单价**。 */
export function V4ModelPopover(): JSX.Element {
  const { t } = useTranslation()
  const rows: readonly { key: string; name: string; cost?: string; value: string }[] = [
    { key: t('agentPanelV4.modelChat'), name: t('agentPanelV4.chatModel'), value: t('agentPanelV4.chatModel') },
    { key: t('agentPanelV4.imageDefault'), name: t('agentPanelV4.imageModel'), cost: t('agentPanelV4.imagePrice'), value: '2K' },
    { key: t('agentPanelV4.videoDefault'), name: t('agentPanelV4.videoModel'), cost: t('agentPanelV4.videoPrice'), value: 'std' },
    { key: t('agentPanelV4.audioDefault'), name: t('agentPanelV4.audioModel'), cost: t('agentPanelV4.audioPrice'), value: '' },
  ]
  return (
    <aside
      className="w-[300px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md"
      data-v4-popover="model"
    >
      <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-2 text-micro text-nomi-ink-40">
        <span>{t('agentPanelV4.modelDialog')}</span>
        <span className="flex-1" />
        <span>{t('agentPanelV4.modelHint')}</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="flex min-h-9 items-center gap-2 px-2.5 text-caption text-nomi-ink hover:bg-nomi-ink-05">
          <span className="w-16 shrink-0 text-micro text-nomi-ink-60">{row.key}</span>
          <span className="truncate">{row.name}</span>
          {row.cost ? <span className="shrink-0 text-micro text-nomi-ink-40">{row.cost}</span> : null}
          <span className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-nomi-sm border border-nomi-line px-2 text-caption">
            {row.value}
            <IconChevronDown size={11} />
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2 border-t border-nomi-line-soft px-2.5 py-2 text-caption text-nomi-ink-60">
        <span>{t('agentPanelV4.modelLibrary')}</span>
        <span className="flex-1" />
        <IconChevronRight size={12} />
      </div>
    </aside>
  )
}

/** Skill 弹层：搜索 + 分类 chip + 列表（名称 + /命令 + 一句描述），hover 行的封面换预览视频。 */
export function V4SkillPopover(): JSX.Element {
  const { t } = useTranslation()
  const categories = [
    t('agentPanelV4.skillAll'),
    t('agentPanelV4.skillMine'),
    t('agentPanelV4.skillScript'),
    t('agentPanelV4.skillShotCat'),
    t('agentPanelV4.skillEditCat'),
  ]
  const skills: readonly { name: string; command: string; desc: string }[] = [
    { name: t('agentPanelV4.skillKasdan'), command: '/kasdan', desc: t('agentPanelV4.skillKasdanDesc') },
    { name: t('agentPanelV4.skillShots'), command: '/shots', desc: t('agentPanelV4.skillShotsDesc') },
    { name: t('agentPanelV4.skillPace'), command: '/pace', desc: t('agentPanelV4.skillPaceDesc') },
    { name: t('agentPanelV4.skillAd'), command: '/product-ad', desc: t('agentPanelV4.skillAdDesc') },
  ]
  return (
    <aside
      className="w-[330px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md"
      data-v4-popover="skill"
    >
      <div className="mx-2.5 mb-1.5 mt-2 flex h-7 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-2 text-caption text-nomi-ink-40">
        {t('agentPanelV4.skillSearch')}
      </div>
      <div className="flex gap-1 overflow-hidden px-2.5 pb-1.5">
        {categories.map((category, index) => (
          <span
            key={category}
            className={cn(
              'inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-pill px-2 text-micro',
              index === 0 ? 'bg-nomi-ink text-nomi-paper' : 'bg-nomi-ink-05 text-nomi-ink-60',
            )}
          >
            {category}
          </span>
        ))}
      </div>
      {skills.map((skill, index) => (
        <div
          key={skill.command}
          className={cn('flex items-start gap-2.5 px-2.5 py-2', index === 0 && 'bg-nomi-ink-05')}
        >
          <span
            className={cn(
              'h-9 w-14 shrink-0 rounded-sm',
              index === 0 ? 'bg-nomi-accent-soft' : 'bg-nomi-ink-10',
            )}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="truncate text-caption font-medium text-nomi-ink">
              {skill.name}
              <code className="ml-1 font-nomi-mono text-micro font-normal text-nomi-ink-40">{skill.command}</code>
            </div>
            <div className="truncate text-micro text-nomi-ink-60">{skill.desc}</div>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 border-t border-nomi-line-soft px-2.5 py-2 text-caption text-nomi-ink-60">
        <span>{t('agentPanelV4.skillExplore')}</span>
        <span className="flex-1" />
        <IconPlus size={12} />
        {t('agentPanelV4.skillManage')}
      </div>
    </aside>
  )
}

/** 权限弹层：三档 segmented control（定稿 Composer 板中列下半张）。 */
export function V4PermissionPopover({ permission }: { permission: PermissionTier }): JSX.Element {
  const { t } = useTranslation()
  const tiers: readonly PermissionTier[] = ['step', 'safe-auto', 'project']
  return (
    <aside
      className="w-[300px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper p-2.5 shadow-nomi-md"
      data-v4-popover="permission"
    >
      <div className="inline-flex gap-0.5 rounded-nomi-sm bg-nomi-ink-05 p-0.5">
        {tiers.map((tier) => (
          <span
            key={tier}
            data-tier={tier}
            data-active={tier === permission ? 'true' : undefined}
            className={cn(
              'inline-flex min-h-6 items-center whitespace-nowrap rounded-nomi-sm px-2.5 text-caption',
              tier === permission
                ? 'bg-nomi-paper font-semibold text-nomi-ink shadow-nomi-sm'
                : 'text-nomi-ink-60',
            )}
          >
            {t(`agentPanelV4.permission.${tier}`)}
          </span>
        ))}
      </div>
      <p className="mb-0 mt-2 text-micro leading-relaxed text-nomi-ink-60">
        {t(`agentPanelV4.permissionWhy.${permission}`)}
      </p>
    </aside>
  )
}

export function V4ComposerPopover({ kind, permission }: { kind: ComposerPopover; permission: PermissionTier }): JSX.Element {
  if (kind === 'model') return <V4ModelPopover />
  if (kind === 'skill') return <V4SkillPopover />
  return <V4PermissionPopover permission={permission} />
}
