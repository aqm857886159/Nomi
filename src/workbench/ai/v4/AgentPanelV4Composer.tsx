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
// 接线后这个组件是**受控**的：文本、chip、弹层开关、权限档全部由宿主容器持有。
// 早先它自己 `useState` 一个 value，`submit` 就是 `setValue('')`——长得像能发，
// 按下去只是把框清空。受控之后「有东西可发」和「真的发出去了」是同一条路。
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
import { DEFAULT_PERMISSION_TIER, PERMISSION_TIERS } from './agentPanelV4Types'

function ComposerChip({ chip, removeLabel, onRemove }: { chip: V4Chip; removeLabel: string; onRemove?: () => void }): JSX.Element {
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
      <button type="button" aria-label={`${removeLabel} ${chip.label}`} className="text-nomi-ink-40" onClick={onRemove}>
        <IconX size={11} />
      </button>
    </span>
  )
}

export type AgentPanelV4ComposerProps = {
  panelHeight?: number
  mode?: ComposerMode
  permission?: PermissionTier
  chips?: readonly V4Chip[]
  /** 受控文本。没有 `onValueChange` 时框是只读的展示件（设计实验室取景用）。 */
  value?: string
  onValueChange?: (value: string) => void
  onSubmit?: () => void
  onStop?: () => void
  onRemoveChip?: (chip: V4Chip, index: number) => void
  onAddFile?: () => void
  /** 模型钮上显示的文字。没选模型时由调用方给「去选模型」一类的实话，不写死型号。 */
  modelLabel?: string
  /** 当前打开的弹层；一次只开一个（定稿）。 */
  openPopover?: ComposerPopover | null
  onTogglePopover?: (popover: ComposerPopover) => void
  /** 弹层本体。由容器渲染（它才知道模型/技能清单），composer 只负责定位。 */
  popover?: React.ReactNode
  /** 收起坞（结果全屏）：同一个 composer 落到画面下沿，上限 6 行。 */
  dock?: boolean
  skillSelected?: boolean
  focused?: boolean
  /** 输入框本体。容器要能把光标交给它（空态起手 chip 填完那句话就聚焦）。 */
  inputRef?: React.Ref<HTMLTextAreaElement>
}

export function AgentPanelV4Composer({
  panelHeight = 620,
  mode = 'idle',
  permission = DEFAULT_PERMISSION_TIER,
  chips,
  value = '',
  onValueChange,
  onSubmit,
  onStop,
  onRemoveChip,
  onAddFile,
  modelLabel,
  openPopover = null,
  onTogglePopover,
  popover,
  dock = false,
  skillSelected = false,
  focused = false,
  inputRef,
}: AgentPanelV4ComposerProps): JSX.Element {
  const { t } = useTranslation()
  const rows = Math.max(1, value.split('\n').length)
  const chipRows = chips?.length ? 1 : 0
  const height = useComposerHeight(panelHeight, dock ? 'dock' : mode, rows, chipRows)
  // 高度是**下限 + 上限**，不是写死值：`height` 是规则算出来的自然高（一行 86px、逐行长），
  // 上限由面板高 derive。中间交给内容——附件 chip 换行时框跟着长，不会把文字压没
  // （首版把 height 当固定值，三个 chip 一换行就把 textarea 挤掉了半行）。
  const cap = maxComposerHeight(panelHeight, dock ? 'dock' : mode)
  const policy = approvalPolicyForTier(permission)
  const running = mode === 'running'
  // 「有东西可发」是**一个**判据，发送钮的长相、它的 disabled、以及 Enter 那条路都从这里取，
  // 免得三处各判一次、以后有人只改了其中一处（长相灰着但 Enter 还能发＝还是在假装能发）。
  const canSend = Boolean(value.trim() || chips?.length)
  return (
    <form
      className={cn(
        'relative flex shrink-0 flex-col overflow-visible rounded-nomi border border-nomi-line bg-nomi-paper',
        focused && 'border-nomi-accent shadow-[0_0_0_3px_var(--nomi-accent-soft)]',
        running && 'shadow-[0_0_0_1px_var(--nomi-accent-soft)]',
        dock && 'shadow-nomi-lg',
      )}
      style={{ minHeight: height, maxHeight: cap }}
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend) onSubmit?.()
      }}
      data-v4-block="composer"
      data-mode={mode}
      data-height={height}
      data-permission={permission}
      data-approval-mode={policy.mode}
      data-spend-policy={policy.spend}
    >
      {/* 弹层挂在 composer 上沿：它必须能盖出框外，所以这一层不能 `overflow-hidden`。
          内部滚动由 textarea 自己的 `overflow-y-auto` 管，两者不冲突。 */}
      {popover ? (
        <div className="absolute bottom-full left-0 z-30 mb-1.5" data-v4-popover-anchor="true">
          {popover}
        </div>
      ) : null}
      {chips?.length ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 px-2.5 pt-2">
          {chips.map((chip, index) => (
            <ComposerChip
              key={`${chip.kind}-${chip.label}`}
              chip={chip}
              removeLabel={t('agentPanelV4.removeChip')}
              onRemove={() => onRemoveChip?.(chip, index)}
            />
          ))}
        </div>
      ) : null}
      <textarea
        ref={inputRef}
        value={value}
        readOnly={!onValueChange}
        onChange={(event) => onValueChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (
            shouldSubmitComposer({
              key: event.key,
              shiftKey: event.shiftKey,
              isComposing: event.nativeEvent.isComposing,
            })
          ) {
            event.preventDefault()
            if (canSend) onSubmit?.()
          }
        }}
        placeholder={running ? t('agentPanelV4.placeholderRunning') : t('agentPanelV4.placeholder')}
        aria-label={t('agentPanelV4.message')}
        rows={1}
        data-v4-control="input"
        // 封顶后内部滚动；`overscroll-contain` 让滚轮到边界不外泄到画布 / 时间轴
        // （2026-08-13 提示词滚轮那条坑同一根因）。
        className="min-h-0 w-full flex-1 resize-none overflow-y-auto overscroll-contain bg-transparent px-3 pb-1.5 pt-2.5 text-body-sm leading-normal text-nomi-ink outline-none placeholder:text-nomi-ink-40"
      />
      <div className="flex h-10 shrink-0 items-center gap-1 px-2 pb-2 pt-1">
        <button
          type="button"
          aria-label={t('agentPanelV4.addAnyFile')}
          onClick={onAddFile}
          data-v4-control="add-file"
          className="grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-80 hover:bg-nomi-ink-05"
        >
          <IconPlus size={16} />
        </button>
        <button
          type="button"
          onClick={() => onTogglePopover?.('model')}
          aria-expanded={openPopover === 'model'}
          className="inline-flex h-7 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-nomi-sm px-2 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05"
          data-v4-control="model"
        >
          {modelLabel ?? t('agentPanelV4.model')}
          <IconChevronDown size={12} />
        </button>
        <span className="mx-0.5 h-4 w-px shrink-0 bg-nomi-line" aria-hidden="true" />
        <button
          type="button"
          onClick={() => onTogglePopover?.('skill')}
          aria-expanded={openPopover === 'skill'}
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
          onClick={() => onTogglePopover?.('permission')}
          aria-expanded={openPopover === 'permission'}
          className="inline-flex h-7 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-nomi-sm px-2 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05"
          data-v4-control="permission"
        >
          {t(`agentPanelV4.permission.${permission}`)}
          <IconChevronDown size={12} />
        </button>
        {/* 有东西可发才点亮（文本或已挂 chip）。画布自己两种画法都出现过——
            高度① 那格（专门讲空框）画的是灰钮，Flow 三板画的是深钮。
            取「空框不该假装能发」这一条：它是那格的**论点**，另两处只是背景。
            2026-09-06 用户拍板补齐：灰只是长相，钮还是能按（Enter 也照样触发 submit），
            那就还是在假装能发。空态直接 `disabled`——点不动、键盘跳过、读屏念「已停用」，
            长相和行为这才是同一件事。running 态是「停止」，永远可按。 */}
        <button
          type={running ? 'button' : 'submit'}
          disabled={!running && !canSend}
          onClick={running ? onStop : undefined}
          aria-label={running ? t('agentPanelV4.stop') : t('agentPanelV4.send')}
          className={cn(
            'grid size-[30px] shrink-0 place-items-center rounded-pill',
            running
              ? 'border-[1.5px] border-nomi-ink bg-nomi-paper text-nomi-ink'
              : canSend
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

export type V4ModelRow = Readonly<{
  /** 行首那个小标签：「对话」「图片默认」…… */
  slot: string
  name: string
  /** 预计单价。目录没写价就没有——不印 `≈¥0.00`。 */
  cost?: string
  /** 行尾胶囊里的规格（2K / std / …）。没有规格的行不画胶囊。 */
  value?: string
  onSelect?: () => void
}>

/** 模型弹层：四行一个层，替换现役「去选文本模型 / 去模型库添加」两级冗余。每行带**预计单价**。 */
export function V4ModelPopover({ rows, onOpenLibrary }: { rows: readonly V4ModelRow[]; onOpenLibrary?: () => void }): JSX.Element {
  const { t } = useTranslation()
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
        <button
          type="button"
          key={row.slot}
          onClick={row.onSelect}
          className="flex min-h-9 w-full items-center gap-2 px-2.5 text-left text-caption text-nomi-ink hover:bg-nomi-ink-05"
        >
          <span className="w-16 shrink-0 text-micro text-nomi-ink-60">{row.slot}</span>
          <span className="truncate">{row.name}</span>
          {row.cost ? <span className="shrink-0 text-micro text-nomi-ink-40">{row.cost}</span> : null}
          {row.value ? (
            <span className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-nomi-sm border border-nomi-line px-2 text-caption">
              {row.value}
              <IconChevronDown size={11} />
            </span>
          ) : null}
        </button>
      ))}
      <button
        type="button"
        onClick={onOpenLibrary}
        className="flex w-full items-center gap-2 border-t border-nomi-line-soft px-2.5 py-2 text-left text-caption text-nomi-ink-60 hover:bg-nomi-ink-05"
      >
        <span>{t('agentPanelV4.modelLibrary')}</span>
        <span className="flex-1" />
        <IconChevronRight size={12} />
      </button>
    </aside>
  )
}

export type V4CommandRow = Readonly<{
  id: string
  name: string
  /** `/命令`。提示词库那一段也有，它就是把提示词当命令用的那个名字。 */
  command: string
  desc: string
  /** 分段名：技能 / 提示词。同一个菜单两段，各自有名字（2026-09-06 拍板 ⑤）。 */
  section: string
  selected?: boolean
}>

/**
 * `/` 命令弹层：搜索 + 分类 chip + 列表（名称 + /命令 + 一句描述）。
 *
 * **提示词库并进了这里**（拍板 ⑤）。理由是同一个问题：现役底栏有「Skill」和「提示词」
 * 两个钮，而用户那一刻想的是同一件事——「给这次对话装一套说法」。两个入口意味着
 * 用户得先学会我们对「技能」和「提示词」的区分，才能开始干活。合成一个菜单、两段有名字，
 * 分不清的人照样能用搜索找到，分得清的人一眼看到分段。
 */
export function V4SkillPopover({
  rows,
  categories,
  activeCategory,
  query,
  onQueryChange,
  onSelectCategory,
  onSelect,
  onManage,
}: {
  rows: readonly V4CommandRow[]
  categories: readonly string[]
  activeCategory?: string
  query?: string
  onQueryChange?: (value: string) => void
  onSelectCategory?: (category: string) => void
  onSelect?: (row: V4CommandRow) => void
  onManage?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  let lastSection = ''
  return (
    <aside
      className="w-[330px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md"
      data-v4-popover="skill"
    >
      <input
        value={query ?? ''}
        readOnly={!onQueryChange}
        onChange={(event) => onQueryChange?.(event.target.value)}
        placeholder={t('agentPanelV4.skillSearch')}
        aria-label={t('agentPanelV4.skillSearch')}
        data-v4-control="skill-search"
        className="mx-2.5 mb-1.5 mt-2 flex h-7 w-[calc(100%-20px)] items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-transparent px-2 text-caption text-nomi-ink outline-none placeholder:text-nomi-ink-40"
      />
      <div className="flex gap-1 overflow-hidden px-2.5 pb-1.5">
        {categories.map((category, index) => (
          <button
            type="button"
            key={category}
            onClick={() => onSelectCategory?.(category)}
            className={cn(
              'inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-pill px-2 text-micro',
              (activeCategory ?? categories[0]) === category || (activeCategory === undefined && index === 0)
                ? 'bg-nomi-ink text-nomi-paper'
                : 'bg-nomi-ink-05 text-nomi-ink-60',
            )}
          >
            {category}
          </button>
        ))}
      </div>
      <div className="max-h-[260px] overflow-y-auto overscroll-contain">
        {rows.map((row) => {
          const header = row.section !== lastSection ? row.section : ''
          lastSection = row.section
          return (
            <React.Fragment key={row.id}>
              {header ? (
                <div className="px-2.5 pb-0.5 pt-1.5 text-micro text-nomi-ink-40">{header}</div>
              ) : null}
              <button
                type="button"
                onClick={() => onSelect?.(row)}
                data-v4-command={row.id}
                className={cn('flex w-full items-start gap-2.5 px-2.5 py-2 text-left', row.selected && 'bg-nomi-ink-05')}
              >
                <span
                  className={cn('h-9 w-14 shrink-0 rounded-sm', row.selected ? 'bg-nomi-accent-soft' : 'bg-nomi-ink-10')}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block truncate text-caption font-medium text-nomi-ink">
                    {row.name}
                    <code className="ml-1 font-nomi-mono text-micro font-normal text-nomi-ink-40">{row.command}</code>
                  </span>
                  <span className="block truncate text-micro text-nomi-ink-60">{row.desc}</span>
                </span>
              </button>
            </React.Fragment>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onManage}
        className="flex w-full items-center gap-2 border-t border-nomi-line-soft px-2.5 py-2 text-left text-caption text-nomi-ink-60 hover:bg-nomi-ink-05"
      >
        <span>{t('agentPanelV4.skillExplore')}</span>
        <span className="flex-1" />
        <IconPlus size={12} />
        {t('agentPanelV4.skillManage')}
      </button>
    </aside>
  )
}

/** 权限弹层：三档 segmented control（定稿 Composer 板中列下半张）。 */
export function V4PermissionPopover({
  permission,
  onSelect,
}: {
  permission: PermissionTier
  onSelect?: (tier: PermissionTier) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <aside
      className="w-[300px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper p-2.5 shadow-nomi-md"
      data-v4-popover="permission"
    >
      <div className="inline-flex gap-0.5 rounded-nomi-sm bg-nomi-ink-05 p-0.5">
        {PERMISSION_TIERS.map((tier) => (
          <button
            type="button"
            key={tier}
            data-tier={tier}
            data-active={tier === permission ? 'true' : undefined}
            onClick={() => onSelect?.(tier)}
            className={cn(
              'inline-flex min-h-6 items-center whitespace-nowrap rounded-nomi-sm px-2.5 text-caption',
              tier === permission
                ? 'bg-nomi-paper font-semibold text-nomi-ink shadow-nomi-sm'
                : 'text-nomi-ink-60',
            )}
          >
            {t(`agentPanelV4.permission.${tier}`)}
          </button>
        ))}
      </div>
      <p className="mb-0 mt-2 text-micro leading-relaxed text-nomi-ink-60">
        {t(`agentPanelV4.permissionWhy.${permission}`)}
      </p>
    </aside>
  )
}
