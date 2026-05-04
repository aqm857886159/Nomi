import { listProjectFlows, listProjects, saveRawProjectFlow, upsertProject, type FlowDto, type ProjectDto } from '../../api/server'
import { normalizeTimeline } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import { normalizeWorkbenchDocument } from '../workbenchPersistence'
import type { WorkbenchDocument } from '../workbenchTypes'
import type { GenerationCanvasNode, GenerationCanvasSnapshot } from '../generationCanvasV2/model/generationCanvasTypes'
import { assertWorkbenchProjectMediaUrlsPersistable } from './projectMediaMigration'
import {
  createDefaultWorkbenchProjectPayload,
  workbenchProjectPayloadSchema,
  type WorkbenchProjectPayload,
  type WorkbenchProjectRecordV1,
  type WorkbenchProjectSummary,
} from './projectRecordSchema'

const NOMI_WORKBENCH_FLOW_NAME = 'Nomi Studio'
const NOMI_WORKBENCH_FLOW_KIND = 'nomi-workbench-project'
const NOMI_WORKBENCH_FLOW_VERSION = 1

type NomiWorkbenchFlowEnvelope = {
  kind: typeof NOMI_WORKBENCH_FLOW_KIND
  version: typeof NOMI_WORKBENCH_FLOW_VERSION
  payload: WorkbenchProjectPayload
}

function toMillis(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : Date.now()
}

function extractCanvasThumbnailUrls(nodes: GenerationCanvasNode[], max = 4): string[] {
  const urls: string[] = []
  for (const node of nodes) {
    if (urls.length >= max) break
    const url = node.result?.url || node.result?.thumbnailUrl
    if (typeof url === 'string' && url.length > 4) urls.push(url)
  }
  return urls
}

function normalizePayload(input: unknown): WorkbenchProjectPayload {
  const parsed = workbenchProjectPayloadSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('服务端项目记录损坏：payload 缺少必要字段')
  }
  return {
    workbenchDocument: normalizeWorkbenchDocument(parsed.data.workbenchDocument),
    timeline: normalizeTimeline(parsed.data.timeline) as TimelineState,
    generationCanvas: parsed.data.generationCanvas as GenerationCanvasSnapshot,
  }
}

function readEnvelope(input: unknown): NomiWorkbenchFlowEnvelope | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  if (record.kind !== NOMI_WORKBENCH_FLOW_KIND || record.version !== NOMI_WORKBENCH_FLOW_VERSION) return null
  return {
    kind: NOMI_WORKBENCH_FLOW_KIND,
    version: NOMI_WORKBENCH_FLOW_VERSION,
    payload: normalizePayload(record.payload),
  }
}

function pickNomiFlow(flows: readonly FlowDto[]): FlowDto | null {
  const matched = flows
    .filter((flow) => readEnvelope(flow.data) || flow.name === NOMI_WORKBENCH_FLOW_NAME)
    .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt))
  return matched[0] || null
}

function toSummary(project: ProjectDto, payload?: WorkbenchProjectPayload): WorkbenchProjectSummary {
  const thumbnailUrls = payload ? extractCanvasThumbnailUrls(payload.generationCanvas.nodes) : []
  return {
    id: project.id,
    name: project.name,
    createdAt: toMillis(project.createdAt),
    updatedAt: toMillis(project.updatedAt),
    ...(thumbnailUrls[0] ? { thumbnail: thumbnailUrls[0] } : {}),
    ...(thumbnailUrls.length ? { thumbnailUrls } : {}),
  }
}

function toRecord(project: ProjectDto, payload: WorkbenchProjectPayload): WorkbenchProjectRecordV1 {
  return {
    ...toSummary(project, payload),
    version: 1,
    payload,
  }
}

async function readProjectPayload(projectId: string): Promise<WorkbenchProjectPayload | null> {
  const flows = await listProjectFlows(projectId)
  const flow = pickNomiFlow(flows)
  if (!flow) return null
  const envelope = readEnvelope(flow.data)
  if (!envelope) {
    throw new Error(`服务端项目记录损坏：${projectId}`)
  }
  return envelope.payload
}

export async function listServerWorkbenchProjects(): Promise<WorkbenchProjectSummary[]> {
  const projects = await listProjects()
  return projects
    .map((project) => toSummary(project))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createServerWorkbenchProject(name?: string): Promise<WorkbenchProjectRecordV1> {
  const project = await upsertProject({
    name: typeof name === 'string' && name.trim() ? name.trim() : '未命名项目',
  })
  const payload = createDefaultWorkbenchProjectPayload()
  const record = toRecord(project, payload)
  await saveServerWorkbenchProject(record.id, payload, record.name)
  return record
}

export async function importServerWorkbenchProject(
  payload: WorkbenchProjectPayload,
  name?: string,
): Promise<WorkbenchProjectRecordV1> {
  const project = await upsertProject({
    name: typeof name === 'string' && name.trim() ? name.trim() : '未命名项目',
  })
  return saveServerWorkbenchProject(project.id, payload, project.name)
}

export async function readServerWorkbenchProject(projectId: string): Promise<WorkbenchProjectRecordV1 | null> {
  const projects = await listProjects()
  const project = projects.find((item) => item.id === projectId)
  if (!project) return null
  const payload = await readProjectPayload(projectId)
  return toRecord(project, payload || createDefaultWorkbenchProjectPayload())
}

export async function saveServerWorkbenchProject(
  projectId: string,
  payload: WorkbenchProjectPayload,
  name?: string,
): Promise<WorkbenchProjectRecordV1> {
  const id = String(projectId || '').trim()
  if (!id) throw new Error('projectId is required')
  const normalizedPayload = normalizePayload(payload)
  assertWorkbenchProjectMediaUrlsPersistable({
    id,
    name: typeof name === 'string' && name.trim() ? name.trim() : '未命名项目',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    payload: normalizedPayload,
  })
  const project = await upsertProject({ id, name: typeof name === 'string' && name.trim() ? name.trim() : '未命名项目' })
  const record = toRecord(project, normalizedPayload)
  const existingFlow = pickNomiFlow(await listProjectFlows(project.id))
  const envelope: NomiWorkbenchFlowEnvelope = {
    kind: NOMI_WORKBENCH_FLOW_KIND,
    version: NOMI_WORKBENCH_FLOW_VERSION,
    payload: normalizedPayload,
  }
  await saveRawProjectFlow({
    id: existingFlow?.id,
    projectId: project.id,
    name: NOMI_WORKBENCH_FLOW_NAME,
    data: envelope,
  })
  return record
}
