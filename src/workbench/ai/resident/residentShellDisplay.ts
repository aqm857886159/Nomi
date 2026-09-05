/**
 * 常驻面板里那些**纯**的显示换算：面上叫什么、状态叫什么、介入槽列哪几行、
 * 出错时给人看哪句话、每一条消息挂什么样式。
 *
 * 单独成文件是因为它们与 React 无关（不订阅、不持有状态），留在壳里只会把壳越撑越大
 * （R9 分层 / R12 巨壳门岗：单文件 ≤800 行）。壳负责编排 Host 数据与交互，
 * 「同一个东西该显示成什么」住这里。
 *
 * **带 Tailwind 类名的换算可以住这里**（2026-09-06 更新）。曾经不行：`tailwind.config.ts` 的
 * content 只列 `.tsx`，类名字符串一进 `.ts` 就不再被生成，而且完全静默——`residentItemClassName`
 * 第一次搬进来时，用户气泡的 `ml-auto` / `max-w-[86%]` 当场消失，从右侧小卡片变成整行通栏。
 * 当时的处置是把它搬回壳里 + 留一条「不能搬」的注释，那是**把防线建在人的记忆上**，
 * 而且和本文件存在的理由（R9 分层）正面打架。现在 content 同时扫 `.ts` 与 `.tsx`，
 * 由 `scripts/build-tailwind.test.ts` 守住不再退回去；来龙去脉见
 * `docs/lessons/tailwind-content-ts-classnames-silently-dropped.md`。
 */
import { proposalForTool, readableToolDetailRows } from './residentToolDisplay'
import { cn } from '../../../utils/cn'
import type { WorkspaceMode } from '../../workbenchStore'
import type { ToolCallEvent } from '../workbenchAgentRunner'
import type { ProjectAgentItem, ProjectAgentStatus } from '../../../../electron/shared/projectAgentContracts'
import type { TranslationKey } from '../../../i18n/translationKey'

/** 常驻面板认得的四个面。它是 WorkspaceMode 的子集——面板不出现在项目库那一层。 */
export type ResidentSurface = Extract<WorkspaceMode, 'creation' | 'storyboard' | 'generation' | 'preview'>

type Translate = (key: string, options?: Record<string, unknown>) => string

export function surfaceLabel(t: Translate, surface: ResidentSurface): string {
  return surface === 'generation'
    ? t('agentResident.contextGeneration')
    : surface === 'preview'
      ? t('agentResident.contextPreview')
      : surface === 'storyboard'
        ? t('agentResident.contextStoryboard')
        : t('agentResident.contextCreation')
}

const STATUS_LABEL_KEY = {
  drafting: 'agentResident.planning',
  proposed: 'agentResident.waitingApprovalShort',
  declined: 'agentResident.declined',
  queued: 'agentResident.queued',
  running: 'agentResident.running',
  done: 'agentResident.done',
  failed: 'agentResident.failed',
  stopped: 'agentResident.stopped',
} as const satisfies Record<ProjectAgentStatus, TranslationKey>

export function statusLabel(t: Translate, status: ProjectAgentStatus): string {
  return t(STATUS_LABEL_KEY[status])
}

export function isActiveQueueStatus(status: ProjectAgentStatus): boolean {
  return status === 'queued' || status === 'proposed' || status === 'running'
}

export function interventionDetails(t: Translate, call: ToolCallEvent, args: Record<string, unknown>, proposal?: ReturnType<typeof proposalForTool>): readonly { label: string; value: string }[] {
  const rows = [...readableToolDetailRows(t, call.toolName, args), ...(proposal?.fields ?? [])]
  return rows.filter((row, index, all) => all.findIndex((candidate) => candidate.label === row.label && candidate.value === row.value) === index).slice(0, 12).map((row) => ({ label: row.label, value: row.value }))
}

export function friendlyError(error: unknown, t: Translate): string {
  const code = error instanceof Error ? error.message : ''
  return code === 'project_agent_unavailable' || code === 'project_binding_stale' ? t('agentResident.unavailable') : t('agentResident.sendFailed')
}

/** 每一条消息挂什么样式。纯换算：只看这条消息是什么、有没有被拒，不碰任何 React 状态。 */
export function residentItemClassName(item: ProjectAgentItem, declined: boolean): string {
  if (item.kind === 'user') return 'ml-auto min-h-[52px] max-w-[86%] text-caption text-nomi-paper'
  if (item.kind === 'assistant') return 'max-w-full px-1 text-caption leading-5'
  const ownsCard = (item.kind === 'failure' && !declined) || (item.kind === 'artifact' && (item.status === 'running' || item.status === 'failed'))
  if (ownsCard) return 'max-w-full'
  return cn('rounded-nomi-sm border px-2.5 py-1.5 text-caption', declined ? 'border-nomi-line-soft bg-nomi-ink-05' : 'border-nomi-line-soft bg-nomi-paper')
}
