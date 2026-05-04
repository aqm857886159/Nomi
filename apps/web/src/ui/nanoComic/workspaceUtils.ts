import type {
  AgentsChatResponseDto,
  ProjectBookIndexDto,
  ProjectBookStoryboardHistoryDto,
} from '../../api/server'
import { findModelOptionByIdentifier } from '../../config/useModelOptions'
import type { ModelOption } from '../../config/models'
import {
  getChapterStoryboardPlan,
  getPlanShotPrompts,
  normalizeNanoComicStoryboardGroupSize,
  type StoryboardGroupSize,
} from './storyboardProduction'

export const WORKSPACE_RUNTIME_SUCCESS_TTL_MS = 8000
export const PROJECT_TEXT_REQUIRED_MESSAGE = '当前项目还没有上传文本，请先上传或替换项目文本。'
export const STORYBOARD_EXPERT_SKILL_ID = 'tapcanvas-storyboard-expert'
export const WORKSPACE_ROLE_ANCHOR_BATCH_CONCURRENCY = 4

export function focusCanvasNode(nodeId: string): void {
  try {
    const focusNode = (window as Window & { __tcFocusNode?: (id: string) => void }).__tcFocusNode
    focusNode?.(nodeId)
  } catch {
    // ignore focus failures
  }
}

export function readStoryboardGroupSizeFromHistory(
  history: ProjectBookStoryboardHistoryDto | null,
  chapterNo: number | null,
): StoryboardGroupSize | null {
  const next = history?.progress?.next
  if (!next) return null
  const nextChapter = Number(next.chapter)
  if (chapterNo && Number.isFinite(nextChapter) && nextChapter > 0 && Math.trunc(nextChapter) !== chapterNo) {
    return null
  }
  return normalizeNanoComicStoryboardGroupSize(next.groupSize)
}

export function areLinkedNodeMapsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false
  }
  return true
}

export function buildWorkspaceModelSelectionKey(option: ModelOption): string {
  const vendor = typeof option.vendor === 'string' ? option.vendor.trim() : ''
  const value = typeof option.value === 'string' ? option.value.trim() : ''
  return `${vendor}::${value}`
}

export function findWorkspaceModelOptionBySelectionKey(
  options: readonly ModelOption[],
  selectionKey: string | null | undefined,
): ModelOption | null {
  const rawSelectionKey = typeof selectionKey === 'string' ? selectionKey.trim() : ''
  if (!rawSelectionKey) return null
  const separatorIndex = rawSelectionKey.indexOf('::')
  if (separatorIndex < 0) {
    return findModelOptionByIdentifier(options, rawSelectionKey)
  }
  const vendor = rawSelectionKey.slice(0, separatorIndex).trim()
  const value = rawSelectionKey.slice(separatorIndex + 2).trim()
  if (!value) return null
  return (
    options.find((option) => {
      const optionVendor = typeof option.vendor === 'string' ? option.vendor.trim() : ''
      const optionValue = typeof option.value === 'string' ? option.value.trim() : ''
      return optionVendor === vendor && optionValue === value
    }) ||
    findModelOptionByIdentifier(options, value)
  )
}

export function readWorkspaceRequestedModel(option: ModelOption | null): string {
  if (!option) return ''
  const alias = typeof option.modelAlias === 'string' ? option.modelAlias.trim() : ''
  if (alias) return alias
  const modelKey = typeof option.modelKey === 'string' ? option.modelKey.trim() : ''
  if (modelKey) return modelKey
  return typeof option.value === 'string' ? option.value.trim() : ''
}

export function readRequestedWorkspaceChapterFromSearch(search: string): number | null {
  const rawSearch = String(search || '').trim()
  if (!rawSearch) return null
  try {
    const params = new URLSearchParams(rawSearch)
    const chapter = Number(params.get('chapter') || '')
    return Number.isFinite(chapter) && chapter > 0 ? Math.trunc(chapter) : null
  } catch {
    return null
  }
}

export function readRequestedWorkspaceShotIdFromSearch(search: string): string {
  const rawSearch = String(search || '').trim()
  if (!rawSearch) return ''
  try {
    return String(new URLSearchParams(rawSearch).get('shotId') || '').trim()
  } catch {
    return ''
  }
}

export function isWorkspaceChapterMetadataComplete(chapter: unknown): boolean {
  if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) return false
  const record = chapter as Record<string, unknown>
  const title = String(record.title || '').trim()
  const summary = String(record.summary || '').trim()
  const coreConflict = String(record.coreConflict || '').trim()
  return (
    !!title &&
    !!summary &&
    !!coreConflict &&
    Array.isArray(record.keywords) &&
    record.keywords.length > 0 &&
    Array.isArray(record.characters) &&
    Array.isArray(record.props) &&
    Array.isArray(record.scenes) &&
    Array.isArray(record.locations)
  )
}

export function hasPersistedChapterStoryboardPlan(
  index: ProjectBookIndexDto | null,
  chapterNo: number | null,
): boolean {
  const plan = getChapterStoryboardPlan(index, chapterNo)
  if (!plan) return false
  return getPlanShotPrompts(plan).length > 0
}

export function hasStoryboardPlanUpsertToolEvidence(response: AgentsChatResponseDto | null): boolean {
  const toolNames = Array.isArray(response?.trace?.toolEvidence?.toolNames)
    ? response.trace.toolEvidence.toolNames
    : []
  return toolNames.includes('tapcanvas_book_storyboard_plan_upsert')
}

export function buildChapterScriptPersistenceErrorMessage(response: AgentsChatResponseDto | null): string {
  const turnVerdictStatus = response?.trace?.turnVerdict?.status
  const diagnosticFlags = Array.isArray(response?.trace?.diagnosticFlags) ? response.trace.diagnosticFlags : []
  const diagnosticDetail = diagnosticFlags[0]?.detail ? `：${diagnosticFlags[0].detail}` : ''
  if (!hasStoryboardPlanUpsertToolEvidence(response)) {
    return '章节剧本结果未写回当前工作台：本轮没有调用章节剧本持久化工具 tapcanvas_book_storyboard_plan_upsert。'
  }
  if (turnVerdictStatus === 'partial' || turnVerdictStatus === 'failed') {
    return `章节剧本结果未完整落盘：agents 返回 ${turnVerdictStatus}，请检查执行日志${diagnosticDetail}`
  }
  return '章节剧本结果未写回当前工作台：刷新后仍未发现当前章节的 storyboardPlans。'
}

export function didBackendWriteCanvas(response: AgentsChatResponseDto | null): boolean {
  return (
    response?.agentDecision?.canvasAction === 'write_canvas' ||
    response?.trace?.toolEvidence?.wroteCanvas === true
  )
}

export function buildRuntimeStamp(label: string): { updatedAtLabel: string; updatedAtMs: number } {
  const updatedAtMs = Date.now()
  return {
    updatedAtLabel: `${label}：${new Date(updatedAtMs).toLocaleString()}`,
    updatedAtMs,
  }
}

export function resolveShotVideoProductionStatus(input: {
  runtimeStatus?: 'idle' | 'running' | 'success' | 'error'
  hasPersistedVideo: boolean
}): string {
  if (input.runtimeStatus === 'running') return '视频生成中'
  if (input.runtimeStatus === 'success') return '视频已生成'
  if (input.runtimeStatus === 'error') return '视频失败'
  if (input.hasPersistedVideo) return '视频已生成'
  return '待生成片段'
}

export function resolveShotStoryboardProductionStatus(input: {
  chapterRunStatus?: 'running' | 'success' | 'error'
  hasStoryboardImage: boolean
}): string {
  if (input.chapterRunStatus === 'running') return '分镜生成中'
  if (input.chapterRunStatus === 'error') return '分镜失败'
  if (input.hasStoryboardImage) return '已出分镜'
  return '待生成分镜'
}
