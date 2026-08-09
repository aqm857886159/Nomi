// 能力核 · 方法路由（单一真相源）。
// RPC 传输（rpcServer）与 headless host（host）共用这一份 method→core 映射，杜绝两份路由漂移（P1）。
import {
  addProjectNodes,
  connectProjectNodes,
  createNamedProject,
  deleteProjectNodes,
  generateOnProject,
  listAllProjects,
  listAvailableModels,
  readProjectCanvas,
  setProjectNodePrompt,
  type FetchTaskResultFn,
  type GenerateInput,
  type RunTaskFn,
} from './core'
import { listSkillSummaries, readSkillContent } from '../skills/skillStore'
import type { ProductionRunService } from '../productionRun/productionRunService'
import type { ProductionBrief } from '../productionRun/productionRunTypes'
import type { ProjectGateway } from './gateway'
import type { CapabilityOriginHost } from './security'

export class RpcError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message)
  }
}

export function projectIdOf(params: Record<string, unknown>): string {
  return typeof params.projectId === 'string' ? params.projectId : ''
}

/**
 * makeGateway：按 projectId 解析该用哪个网关——A 模式（app 开着且该项目正打开）→ 渲染层网关（实时）；
 * 否则 → 磁盘网关（直写盘）。rpcServer 据 isProjectOpen + 渲染层可达性提供；headless host 恒磁盘网关。
 */
export type DispatchContext = {
  runTask: RunTaskFn
  fetchTaskResult?: FetchTaskResultFn
  makeGateway: (projectId: string) => ProjectGateway
  productionRuns: Pick<ProductionRunService, 'createDraft' | 'readProjection' | 'readEvents' | 'readArtifactProjection'>
  /** Transport-owned authority. Request bodies may provide only an audit label, never trust. */
  origin?: { host: CapabilityOriginHost; actorId?: string }
}

const PRODUCTION_START_FIELDS = new Set([
  'projectId', 'playbook', 'playbookVersion', 'host', 'actorId', 'brief',
])

function requiredIdentifier(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === '.' || normalized === '..') throw new RpcError(`Invalid ${label} id`, 400)
  return normalized
}

function assertOnlyFields(params: Record<string, unknown>, allowed: Set<string>): void {
  const unexpected = Object.keys(params).find((key) => !allowed.has(key))
  if (unexpected) throw new RpcError(`Production field is not allowed: ${unexpected}`, 400)
}

function optionalText(value: unknown, label: string, max = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > max) throw new RpcError(`Invalid ${label}`, 400)
  return normalized
}

function stringList(value: unknown, label: string, maxItems = 20): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxItems) throw new RpcError(`Invalid ${label}`, 400)
  return value.map((item, index) => optionalText(item, `${label}[${index}]`) as string)
}

function productionBrief(value: unknown): ProductionBrief {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RpcError('Invalid production brief', 400)
  const raw = value as Record<string, unknown>
  const allowed = new Set(['goal', 'audience', 'channel', 'tone', 'durationSeconds', 'sellingPoints', 'referenceArtifactIds'])
  const unexpected = Object.keys(raw).find((key) => !allowed.has(key))
  if (unexpected) throw new RpcError(`Production brief field is not allowed: ${unexpected}`, 400)
  const goal = optionalText(raw.goal, 'brief goal', 2_000)
  if (!goal) throw new RpcError('Production brief goal is required', 400)
  const duration = raw.durationSeconds === undefined ? undefined : Number(raw.durationSeconds)
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 1 || duration > 3_600)) {
    throw new RpcError('Invalid brief durationSeconds', 400)
  }
  return {
    goal,
    ...(optionalText(raw.audience, 'brief audience') ? { audience: optionalText(raw.audience, 'brief audience') } : {}),
    ...(optionalText(raw.channel, 'brief channel') ? { channel: optionalText(raw.channel, 'brief channel') } : {}),
    ...(optionalText(raw.tone, 'brief tone') ? { tone: optionalText(raw.tone, 'brief tone') } : {}),
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
    ...(raw.sellingPoints !== undefined ? { sellingPoints: stringList(raw.sellingPoints, 'brief sellingPoints') } : {}),
    ...(raw.referenceArtifactIds !== undefined
      ? { referenceArtifactIds: stringList(raw.referenceArtifactIds, 'brief referenceArtifactIds') }
      : {}),
  }
}

function productionStartInput(params: Record<string, unknown>, authority: DispatchContext['origin']) {
  const forbidden = Object.keys(params).find((key) => !PRODUCTION_START_FIELDS.has(key))
  if (forbidden) throw new RpcError(`Production start field is not allowed: ${forbidden}`, 400)
  const actorId = authority?.actorId ?? optionalText(params.actorId, 'origin actor', 160)
  return {
    projectId: requiredIdentifier(params.projectId, 'project'),
    playbook: {
      name: requiredIdentifier(params.playbook, 'playbook'),
      version: optionalText(params.playbookVersion, 'playbook version', 120) ?? '1.0.0',
    },
    origin: {
      host: authority?.host ?? 'external',
      ...(actorId ? { actorId } : {}),
    },
    brief: productionBrief(params.brief),
  }
}

export async function dispatch(method: string, params: Record<string, unknown>, ctx: DispatchContext): Promise<unknown> {
  switch (method) {
    case 'ping':
      return { ok: true }
    case 'project.list':
      return { projects: listAllProjects() }
    case 'project.create':
      return createNamedProject(typeof params.name === 'string' ? params.name : undefined)
    case 'models.list':
      return { models: listAvailableModels() }
    case 'skills.list':
      // 导演/编剧技能库元数据（渐进披露，不含正文）。供 MCP 脊柱 resources/prompts 列表。
      return { skills: listSkillSummaries() }
    case 'skills.read':
      // 按 name/directoryName 读一个技能正文。找不到 ⇒ null（协议层转 error）。
      return readSkillContent(String(params.name || params.directoryName || ''))
    case 'production.start':
      return ctx.productionRuns.createDraft(productionStartInput(params, ctx.origin))
    case 'production.get':
      assertOnlyFields(params, new Set(['projectId', 'runId']))
      return ctx.productionRuns.readProjection(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
      )
    case 'production.events': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'afterCursor', 'waitMs']))
      const afterCursor = params.afterCursor === undefined ? 0 : Number(params.afterCursor)
      const waitMs = params.waitMs === undefined ? 0 : Number(params.waitMs)
      if (!Number.isInteger(afterCursor) || afterCursor < 0) throw new RpcError('Invalid production event cursor', 400)
      if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 25_000) throw new RpcError('Invalid production event waitMs', 400)
      return ctx.productionRuns.readEvents(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
        afterCursor,
        Math.floor(waitMs),
      )
    }
    case 'production.artifact':
      assertOnlyFields(params, new Set(['projectId', 'runId', 'artifactId']))
      return ctx.productionRuns.readArtifactProjection(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
        requiredIdentifier(params.artifactId, 'artifact'),
      )
    case 'canvas.read':
      return readProjectCanvas(ctx.makeGateway(projectIdOf(params)))
    case 'canvas.addNodes':
      return addProjectNodes(ctx.makeGateway(projectIdOf(params)), Array.isArray(params.nodes) ? (params.nodes as never[]) : [], projectIdOf(params))
    case 'canvas.connect':
      return connectProjectNodes(ctx.makeGateway(projectIdOf(params)), Array.isArray(params.connections) ? (params.connections as never[]) : [])
    case 'canvas.setPrompt':
      return setProjectNodePrompt(
        ctx.makeGateway(projectIdOf(params)),
        String(params.nodeId || ''),
        String(params.prompt || ''),
        typeof params.title === 'string' ? params.title : undefined,
      )
    case 'canvas.deleteNodes':
      return deleteProjectNodes(ctx.makeGateway(projectIdOf(params)), Array.isArray(params.nodeIds) ? (params.nodeIds as string[]) : [])
    case 'generate':
      return generateOnProject(params as unknown as GenerateInput, ctx.makeGateway(projectIdOf(params)), ctx.runTask, ctx.fetchTaskResult)
    default:
      throw new RpcError(`未知方法: ${method}`, 404)
  }
}
