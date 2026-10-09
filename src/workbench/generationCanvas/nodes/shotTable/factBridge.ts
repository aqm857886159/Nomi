import { readShotTable, type DeconstructionShotTableDocument } from '../../../../../electron/shared/canvas/shotTable'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { withCanvasGestureContext } from '../../events/canvasGestureContext'
import { pushUndoSnapshot, getUndoJournalGeneration } from '../../events/canvasUndoJournal'
import { interruptPendingCanvasWrite, whenCanvasWriteBoundarySettled } from '../../events/canvasWriteBoundary'
import { resolveNodeVisualSize } from '../nodeSizing'
import { readNodeDeconstruction } from '../deconstructionTypes'
import { createDeconstructionShotTable, deconstructionResultToShotTable } from './shotTableFacts'
import {
  canRestartDeconstruction,
  convergedDeconstructionEntries,
  isDeconstructionRunCancelled,
  markDeconstructionCancelled,
  registerDeconstructionRun,
  releaseDeconstructionRun,
} from './deconstructionLifecycle'
import i18n from '../../../../i18n'

async function writeTable(
  tableNodeId: string,
  canWrite: () => boolean,
  update: (current: DeconstructionShotTableDocument) => DeconstructionShotTableDocument | undefined,
  userEdit = false,
): Promise<boolean> {
  await whenCanvasWriteBoundarySettled()
  if (!canWrite()) return false
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((entry) => entry.id === tableNodeId)
  const current = readShotTable(node?.meta)
  if (!node || current?.source.kind !== 'deconstruction' || !('columns' in current)) return false
  const next = update(current)
  if (!next) return false
  if (userEdit) pushUndoSnapshot()
  store.updateNode(tableNodeId, { meta: { ...node.meta, shotTable: next } }, { history: false })
  return true
}

/** One source, one view. Reopening legacy evidence migrates it without calling the model again. */
export function ensureDeconstructionShotTable(sourceNodeId: string): string | undefined {
  const store = useGenerationCanvasStore.getState()
  const existing = store.nodes.find((node) => {
    const table = readShotTable(node.meta)
    return node.kind === 'shot_table' && table?.source.kind === 'deconstruction' && table.source.sourceNodeId === sourceNodeId
  })
  if (existing) { store.selectNodes([existing.id]); return existing.id }
  const source = store.nodes.find((node) => node.id === sourceNodeId)
  if (!source) return undefined
  let table = createDeconstructionShotTable(sourceNodeId, source.title)
  const legacy = readNodeDeconstruction(source.meta)
  if (legacy) table = deconstructionResultToShotTable(table, legacy)
  interruptPendingCanvasWrite()
  pushUndoSnapshot()
  return withCanvasGestureContext({ source: 'user', txnId: `shot-table-${sourceNodeId}-${Date.now()}`, suppressUndoBarriers: true }, () => {
    const node = store.addNode({
      kind: 'shot_table', title: source.title, categoryId: source.categoryId,
      position: { x: source.position.x + resolveNodeVisualSize(source).width + 80, y: source.position.y },
      meta: { shotTable: table },
    })
    store.connectNodes(sourceNodeId, node.id, undefined, undefined, undefined, { provenance: true })
    store.selectNodes([node.id])
    return node.id
  })
}

/** The returned promise owns the engine call; progress never advances on timers. */
export async function deconstructToShotTable(
  sourceNodeId: string,
  project: ProjectExecutionContext,
  /**
   * 这次对白走哪条转写线。不给 = 沿用自动解析。
   * `'cloud'` 是本地那条挂了之后用户点「改用云端重试」传进来的——**必须是显式动作**，
   * 代码不许在失败时自己切（那样用户会在不知情的情况下花钱，也就再没人知道本地那条坏了）。
   */
  transcribe?: { vendorKey: string; modelKey: string } | 'cloud',
): Promise<string | undefined> {
  const { projectId } = project.binding
  const generation = getUndoJournalGeneration()
  // 发起拆解那一刻签发的原项目仍有效才写回（A→B→A 也不复活）。
  const canWrite = () => getUndoJournalGeneration() === generation && isProjectExecutionContextCurrent(project)
  const id = ensureDeconstructionShotTable(sourceNodeId)
  if (!id) return undefined
  const store = useGenerationCanvasStore.getState()
  const source = store.nodes.find((node) => node.id === sourceNodeId)
  const table = readShotTable(store.nodes.find((node) => node.id === id)?.meta)
  if (!source || !table || table.source.kind !== 'deconstruction' || !('columns' in table)) return id
  // 能不能再起一次由终态 owner 答（`running` 会起第二条，`ready` 已经有结果）。
  // 中断 / 取消都是可以再起的终态——它们正是「找回入口」通向的地方。
  if (!canRestartDeconstruction(table.source.status)) return id
  const deconstruct = getDesktopBridge()?.video?.deconstruct
  if (!deconstruct || !projectId || !source.result?.url) {
    await writeTable(id, canWrite, current => ({ ...current, source: { ...current.source, status: 'failed', errorMessage: i18n.t('generationCommon.node.deconstruct.desktopOnly') } }))
    return id
  }
  const started = await writeTable(id, canWrite, current => !canRestartDeconstruction(current.source.status)
    ? undefined : { ...current, source: { ...current.source, status: 'running', errorMessage: undefined, failureKind: undefined }, updatedAt: new Date().toISOString() })
  if (!started || !canWrite()) return id
  const requestId = crypto.randomUUID()
  // 在飞登记：从这里到 finally 之间，`running` 这一格才由一个**活着的 promise** 作保。
  // 登记与这个渲染进程同寿命——进程没了它自然空，下次读回来的 running 会被判为中断。
  registerDeconstructionRun(id, requestId)
  const unsubscribe = getDesktopBridge()?.video?.onDeconstructionProgress?.((event) => {
    if (event.requestId !== requestId || event.projectId !== projectId || !canWrite()) return
    // detail 是阶段内部那句更细的话（本地转写的下载/分段进度）。主进程按用户语言生成好再发，
    // 渲染层原样显示——同一句话不在两边各拼一次。
    void writeTable(id, canWrite, current => ({ ...current, source: { ...current.source, phase: event.phase, progressDetail: event.detail || undefined } }))
  })
  try {
    const result = await deconstruct({
      // nodeId：这次拆解的付费令牌按它记预算，主进程的一次报价卡也按它显示是哪张表。
      videoUrl: source.result.url, projectId, requestId, nodeId: id, ...(transcribe ? { transcribe } : {}),
      customColumns: table.columns.filter((column) => column.kind === 'custom').map((column) => ({ name: column.columnId, hint: column.hint || column.labelKey })),
    })
    // A completion from a departed project must never write into its successor.
    if (!canWrite()) return id
    // 用户在这次跑的中途按了「取消」：结果作废，取消态是终态，不许被迟到的 ready 拽回去。
    if (isDeconstructionRunCancelled(id, requestId)) return id
    await writeTable(id, canWrite, current => deconstructionResultToShotTable({ ...current, source: { ...current.source, progressDetail: undefined } }, result))
  } catch (error) {
    if (!canWrite()) return id
    if (isDeconstructionRunCancelled(id, requestId)) return id
    // 引擎侧任何一条挂了（ffmpeg 子进程被杀 / 供应商超时 / 抽帧失败）都在这里落失败态并带上原话。
    await writeTable(id, canWrite, current => ({ ...current, source: { ...current.source, status: 'failed', progressDetail: undefined, errorMessage: error instanceof Error ? error.message : String(error) } }))
  } finally {
    unsubscribe?.()
    releaseDeconstructionRun(id, requestId)
    // 终态兜底：上面每一条 `return id` 都是「这次调用不许把结果写进这张表」，
    // 但**表不能因此停在 running**——那正是 T-ED-06 那一格。
    settleInterruptedDeconstructions()
  }
  return id
}

/**
 * 把当前画布上所有「停在 running 却没有在飞调用」的表收敛到中断态。
 *
 * 为什么是**整张画布扫一遍**而不是只写发起时那个 id：收敛不是一次「完成结果」，
 * 它不携带引擎的任何产出，而是一句关于**此刻这张画布**的真话——
 * 「这个节点上没有活着的调用」。所以它不需要、也不该套那道「原项目仍当前」的写回闸
 * （那道闸挡的是迟到的**结果**）；反过来，正因为判据只来自当前画布 + 当前在飞登记，
 * 它也不可能把话写进别的项目：换了项目，扫的就是那个项目的画布，结论照样为真。
 */
export function settleInterruptedDeconstructions(): void {
  const store = useGenerationCanvasStore.getState()
  // 扫描与判据都在 owner 那一份里；这里只负责**怎么落笔**——走 updateNode 而不是直接
  // setState，才会进持久化与事件日志（收敛结果本身也要能跨重启留下来）。
  for (const { node, table } of convergedDeconstructionEntries(store.nodes)) {
    store.updateNode(node.id, { meta: { ...node.meta, shotTable: { ...table, updatedAt: new Date().toISOString() } } }, { history: false })
  }
}

/**
 * 用户取消这次拆解。IPC 的 invoke 没有取消口，所以取消 = **把这次调用的结果作废**：
 * 主进程那边跑完就跑完了，回来的东西不再写进表。
 *
 * 为什么取消是独立一格而不是 `failed`：没出错，是用户不要了。把它记成失败会在日志、
 * 在「这台机器上拆解成功率」里都留下一条假的失败。
 */
export function cancelDeconstruction(tableNodeId: string): void {
  // 没有在飞的调用却停在 running = 这次拆解**早就已经死了**（进程重启前留下的影子）。
  // 那一下点击仍然必须有反应：按 owner 的判据落中断态，而不是一颗点不动的按钮——
  // 「看着能点、点了没事」正是 T-ED-06 那一格的另一种形态。
  if (!markDeconstructionCancelled(tableNodeId)) { settleInterruptedDeconstructions(); return }
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((entry) => entry.id === tableNodeId)
  const table = readShotTable(node?.meta)
  if (!node || table?.source.kind !== 'deconstruction' || !('columns' in table)) return
  store.updateNode(tableNodeId, { meta: { ...node.meta, shotTable: {
    ...table,
    // 同 convergeDeconstructionTable：取消没有原因可抄，那句话在渲染时按当前语言取。
    source: { ...table.source, status: 'cancelled', phase: undefined, progressDetail: undefined, errorMessage: undefined },
    updatedAt: new Date().toISOString(),
  } } }, { history: false })
}


/** Retry one failed analysis while preserving measured evidence, custom edits and selection on every other row. */
export async function retryShot(tableNodeId: string, rowId: string, project: ProjectExecutionContext): Promise<void> {
  const { projectId } = project.binding
  const generation = getUndoJournalGeneration()
  const canvas = useGenerationCanvasStore.getState()
  const table = readShotTable(canvas.nodes.find(node => node.id === tableNodeId)?.meta)
  if (!table || table.source.kind !== 'deconstruction' || !('rows' in table) || !table.rows || !projectId) return
  const row = table.rows.find(item => item.rowId === rowId)
  const source = canvas.nodes.find(node => node.id === table.source.sourceNodeId)
  const deconstruct = getDesktopBridge()?.video?.deconstruct
  if (!row || !source?.result?.url || !deconstruct) return
  const result = await deconstruct({ videoUrl: source.result.url, projectId, shotIndexes: [row.order], nodeId: tableNodeId,
    customColumns: table.columns.filter(column => column.kind === 'custom').map(column => ({ name: column.columnId, hint: column.hint || column.labelKey })),
  })
  const canWrite = () => getUndoJournalGeneration() === generation && isProjectExecutionContextCurrent(project)
  if (!canWrite()) return
  await writeTable(tableNodeId, canWrite, latest => {
    const fresh = deconstructionResultToShotTable(latest, result).rows.find(item => item.rowId === rowId)
    if (!fresh) return undefined
    const rows = latest.rows.map(item => item.rowId !== rowId ? item : {
      ...fresh, rowId: item.rowId, order: item.order, startSeconds: item.startSeconds, endSeconds: item.endSeconds,
      durationSeconds: item.durationSeconds, keyframeRef: item.keyframeRef ?? fresh.keyframeRef,
    })
    return { ...latest, rows, source: { ...latest.source, failedShotIndexes: rows.filter(item => item.visionFailed).map(item => item.order) },
      revision: latest.revision + 1, updatedAt: new Date().toISOString() }
  }, true)
}
