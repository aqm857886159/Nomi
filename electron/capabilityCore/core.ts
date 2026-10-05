// 能力核 · 编排层（见 docs/plan/2026-06-20-capability-core-headless-exposure.md）。
//
// 把纯图操作（canvasGraph）接到真实的工程持久化（projects/repository）。这是「外部 agent / CLI / MCP
// 驱动 Nomi」读写工程与画布的**主进程**单一执行口——所有传输（RPC / 头less host）都调这里，不各自实现一遍（P1）。
//
// 模式说明：本文件实现 **B 模式**（app 关着，直接读写 project.json）。当 app 开着时，
// 工程的内存 store 才是真相、会防抖回盘覆盖文件改动（见 workbenchProjectSession），故 app 开着时
// 图变更必须经运行中实例（A 模式，rpcServer 转发给 renderer），不能在此直写文件。调用方（rpcServer/
// host）负责按「app 是否开着」选模式；本核只管把 B 模式做对、做纯。
//
// 付费生成不在这里：外部 agent / MCP 的生成只走语义生成那条路（`nomi_operation_*` → ProductionRun 提交出口）。
// 这里曾有一条 `generateOnProject`（经网关铸令牌后直调 runtime.runTask，连带审片环与两跳首帧），
// 2026-10-05 核实没有任何生产调用方，按 P1 整族删除（docs/plan/2026-10-05-engine-convergence-cut1.md §1.2）。
import fs from 'node:fs'
import path from 'node:path'
import { listProjects, createProject, readProject } from '../projects/repository'
import { readCatalog } from '../catalog/catalogStore'
import { deriveModelListing, type ModelListingEntry } from '../catalog/modelCatalogListing'
import {
  addNodes,
  connectNodes,
  deleteNodes,
  setNodePrompt,
  type ConnectionSpec,
  type NodeSpec,
} from './canvasGraph'
import type { ProjectGateway } from './gateway'
import { MediaImportRejectedError, importLocalFile } from '../assets/localFileImport'
import { mcpImportRejectionMessage } from './mcpImportRejectionMessage'
import { checkImportAsset, contentTypeForExtension } from './importAssetGuard'
import { assertCatalogModelIdentity } from './canvasModelIdentity'

type TaskResultLike = {
  id?: string
  status?: string
  // 字段宽容：runtime.TaskResult 的可空字段（string | null）也吃，避免传输边界处理 null
  assets?: Array<{
    type?: string
    url?: string
    thumbnailUrl?: string | null
    providerUrl?: string | null
    assetId?: string | null
    text?: string | null
  }>
  raw?: unknown
  /** 终态失败的真实原因（与 runtime.TaskResult.error 同义）。 */
  error?: string
}

/** runTask 的形状（注入式）：传输层把它递给模型试跑（model.onboarding.try），那一路与画布同一个执行器。 */
export type RunTaskFn = (payload: { vendor: string; request: unknown }) => Promise<TaskResultLike>

/** fetchTaskResult 的形状（注入式）。异步 vendor 返 queued，需轮询到终态。 */
export type FetchTaskResultFn = (payload: { taskId: string; vendor: string; taskKind: string; prompt: string; modelKey: string }) => Promise<{ result: TaskResultLike }>

// ── 工程级 ─────────────────────────────────────────────────────────────

/**
 * 把**本机文件**导入项目当素材，返回 `nomi-local://` URL（MCP 清单 M2）。
 *
 * 为什么必须有：agent 想拿手绘帧/截图/用户给的参考图当 references，此前只能靠人先在 GUI 里拖进去——
 * 「让 Agent 端到端跑完」在素材侧是断的。导入后返回的 URL 可进入语义生成提案或当画布节点的源。
 *
 * 安全：判据全在 importAssetGuard（纯函数、逐条单测）——这是「远端 agent 读本机文件」的口子，
 * deny 优先于白名单、且对 realpath 再查一遍（软链逃逸在此断掉）。落盘复用既有 copyAssetFile
 * （不走 Buffer、不另造资产管线，P1）。
 */
export async function importProjectAsset(input: {
  projectId: string
  path: string
  title?: string
}): Promise<{
  url: string
  name: string
  contentType: string
  sizeBytes: number
  assetId: string
  contentHash: string
  version: 1
}> {
  if (!readProject(input.projectId)) throw new Error(`项目不存在: ${input.projectId}`)
  const raw = String(input.path || '')
  // I/O 先做（realpath 解软链 + stat），判据本身保持纯函数。
  let realPath: string | null
  let sizeBytes: number | null = null
  let isFile = false
  try {
    realPath = fs.realpathSync(raw)
    const stat = fs.statSync(realPath)
    sizeBytes = stat.size
    isFile = stat.isFile()
  } catch {
    realPath = null
  }
  // 这里只判**路径安全**（deny 目录优先、软链逃逸、扩展名白名单、文件读不读得出来）。
  // 「多大算大」不在这里判第二遍：唯一 owner 是 importLocalFile 里的准入闸，它按磁盘余量与
  // 每面硬顶判，拒绝时带着数字回到模型（见下面的 mcpImportRejectionMessage）。
  const verdict = checkImportAsset({ rawPath: raw, realPath, sizeBytes, isFile })
  if (!verdict.ok) throw new Error(verdict.reason)

  const fileName = (() => {
    const titled = typeof input.title === 'string' ? input.title.trim() : ''
    const base = titled || path.basename(verdict.realPath)
    // 标题不带扩展名时补上真实扩展名（落盘/回读都靠它认类型）。
    return base.toLowerCase().endsWith(verdict.extension) ? base : `${base}${verdict.extension}`
  })()
  const contentType = contentTypeForExtension(verdict.extension)
  // 落盘走**唯一那条路**（嗅探 + 准入闸 + 视频归一化都在 importLocalFile 里）；meta 在调用方
  // 这一侧收窄成 owner 认的形状，不放宽 owner 的入参去迁就调用者。被准入闸挡下不是「导入失败」：
  // 那一支独有的数字要讲给模型听，否则它会原地重试同一个文件。
  let record: { id?: string; name?: string; data?: { url?: string; size?: number; contentHash?: string } }
  try {
    record = (await importLocalFile(
      { projectId: input.projectId, sourcePath: verdict.realPath, fileName, contentType, kind: 'imported' },
      { allowSourcePath: true },
    )) as typeof record
  } catch (error) {
    if (error instanceof MediaImportRejectedError) throw Object.assign(new Error(mcpImportRejectionMessage(fileName, error.rejection)), { cause: error })
    throw error
  }
  const data = record.data
  const url = data?.url
  if (!url || !record.id || !data?.contentHash) throw new Error('素材已复制但没拿到完整的可引用身份，请重试。')
  return {
    url,
    name: record.name || fileName,
    contentType,
    sizeBytes: data.size ?? sizeBytes ?? 0,
    assetId: record.id,
    contentHash: data.contentHash,
    version: 1,
  }
}

export function listAllProjects(): Array<{ id: string; name: string; updatedAt: number }> {
  return listProjects().map((project) => ({ id: project.id, name: project.name, updatedAt: project.updatedAt }))
}

export function createNamedProject(name?: string): { id: string; name: string } {
  const record = createProject(name ? { name } : {})
  return { id: record.id, name: record.name }
}

/**
 * 列出 catalog 里 enabled 的模型（供外部 agent 选型）——**带真话**：每条附 keyStatus（ok/missing/locked）
 * + 一句人话状态 + 参考承载力（能不能带图/视频/音频、能否多图、哪些模式带）。派生逻辑收口在
 * catalog/modelCatalogListing（复用 secrets 三态健康度 + referenceReachability 承载力判据，P1 不另写一份）。
 * 不静默丢没 key/发不出的模型——照列并标状态，让 agent 能对用户说清"kie 没配 key"而非瞎猜可用。
 */
export function listAvailableModels(): ModelListingEntry[] {
  return deriveModelListing(readCatalog())
}

// ── 画布写操作（经 ProjectGateway：A 模式转发渲染层 / B 模式直写盘，统一逻辑）────

export async function addProjectNodes(gateway: ProjectGateway, specs: NodeSpec[], projectId = ''): Promise<{ ids: string[]; cancelled?: boolean }> {
  // 方案门（Phase B）：≥2 节点 = 一套「方案」→ 落画布前弹应用内确认卡（app 开着时；headless 直放行）。
  // 让用户看到外部 agent 要在自己画布上建什么、可否决。单节点不弹（免费可撤、不加摩擦）。拒绝→不落、回 cancelled。
  if (specs.length >= 2) {
    const approved = await gateway.confirmPlan({
      projectId,
      nodeCount: specs.length,
      titles: specs.map((spec) => (typeof spec.title === 'string' ? spec.title.trim() : '')).filter(Boolean).slice(0, 8),
    })
    if (!approved) return { ids: [], cancelled: true }
  }
  const { snapshot, ids } = addNodes(await gateway.readDoc(), specs, {
    assertModelIdentity: (identity) => assertCatalogModelIdentity(listAvailableModels(), identity),
  })
  await gateway.apply(snapshot)
  return { ids }
}

export async function connectProjectNodes(gateway: ProjectGateway, connections: ConnectionSpec[]): Promise<{
  edgeIds: string[]
  skipped: Array<{ connection: ConnectionSpec; reason: string }>
}> {
  const result = connectNodes(await gateway.readDoc(), connections)
  await gateway.apply(result.snapshot)
  return { edgeIds: result.edgeIds, skipped: result.skipped }
}

export async function setProjectNodePrompt(gateway: ProjectGateway, nodeId: string, prompt: string, title?: string): Promise<{ changed: boolean }> {
  const { snapshot, changed } = setNodePrompt(await gateway.readDoc(), nodeId, prompt, title)
  if (changed) await gateway.apply(snapshot)
  return { changed }
}

export async function deleteProjectNodes(gateway: ProjectGateway, nodeIds: string[]): Promise<{ deleted: string[] }> {
  const { snapshot, deleted } = deleteNodes(await gateway.readDoc(), nodeIds)
  if (deleted.length) await gateway.apply(snapshot)
  return { deleted }
}
