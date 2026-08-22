// 能力核 · app 集成（见 docs/plan/2026-06-20-capability-core-headless-exposure.md §S4）。
//
// 把 RPC server + token + 实例广告接到运行中的 Nomi app：启动时拉起 RPC（127.0.0.1）、ensureToken、
// 写实例广告让外部 CLI/MCP 探测得到「app 开着」；退出时清广告 + 关 server。
// 还维护「当前哪个项目正在窗口里打开」（renderer 经 IPC 上报）供 A/B 守卫用——避免外部直写正在
// 编辑的工程被内存 store 覆盖（rpcServer 注释详述）。
//
// **库指纹 + 心跳**（2026-08-18 §P3-F）：广告写 v2——带 projectsRoot（本实例真正服务的库，取自
// getProjectLocationState，与 runtimePaths 同源，不另派生）+ heartbeatAt（每 HEARTBEAT_INTERVAL_MS 刷新的
// 心跳）+ version:2。非默认库的广告落命名空间文件（instance-<hash>.json），走查/fixture 宿主结构上抢不到生产
// advert。bare-Node launcher 据此校验归属、心跳陈旧即快速失败（见 mcpNodeLauncher）。
//
// 这里只做接线，不碰 main.ts 的其它职责（保持 main.ts 精简、单一关注点）。
import { app } from 'electron'
import crypto from 'node:crypto'
import path from 'node:path'
import { startRpcServer, type RpcServerHandle } from './rpcServer'
import { capabilityCoreDir, ensureCapabilitySigningKey, ensureToken } from './security'
import { clearInstanceAdvertisement, writeInstanceAdvertisement } from './lockfile'
import { HEARTBEAT_INTERVAL_MS, type InstanceAdvertisement } from './instanceAdvert'
import { getProjectLocationState, getWorkspaceRepositoryDeps } from '../runtimePaths'
import type { FetchTaskResultFn, RunTaskFn } from './core'
import { getProductionRunService } from '../productionRun/productionRunRuntime'
import { createProjectLeaseAuthority, type ProjectLeaseAuthority } from './projectLease'
import { createProjectLeaseStore } from './projectLeaseStore'
import { createApprovalReceiptAuthority, type ApprovalReceiptAuthority } from './approvalReceipt'
import { createProductionRunLock } from '../productionRun/productionRunLock'
import { readWorkspaceProject } from '../workspace/workspaceRepository'
import { createCurrentProjectResolver, deriveProjectIdentityDigests } from './currentProjectResolver'
import type { ProjectSelectionHandleV1 } from './projectLease'
import type { McpGenerationPolicy } from './mcpGenerationPolicy'
import type { DispatchContext } from './dispatcher'
import { requestRenderer, rendererTargetIdentity } from './rendererBridge'

let handle: RpcServerHandle | null = null
let openProjectId = ''
// 心跳定时器 + 当前广告所在库（退出时按同一命名空间文件名清理）。
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let advertisedLibrary: { projectsRoot: string; isDefault: boolean } | null = null

function createDefaultAuthorities(): Pick<
  DispatchContext,
  'projectLeaseAuthority' | 'resolveProjectSelection' | 'resolveCurrentProject' | 'approvalReceiptAuthority' | 'projectRevisionResolver'
  | 'confirmGenerationInNomi'
> {
  const authorityDir = capabilityCoreDir()
  const sharedLock = createProductionRunLock({
    filePath: path.join(authorityDir, 'semantic-authorities.lock'),
    epochPath: path.join(authorityDir, 'semantic-authorities.epoch'),
    ownerId: `capability-core-${process.pid}`,
  })
  const leaseKey = ensureCapabilitySigningKey('project-lease')
  const leaseAuthority = createProjectLeaseAuthority({
    macKey: leaseKey,
    keyId: 'project-lease-v1',
    store: createProjectLeaseStore({
      filePath: path.join(authorityDir, 'project-leases.json'),
      macKey: ensureCapabilitySigningKey('project-lease-store'),
      keyId: 'project-lease-store-v1',
      lock: sharedLock,
    }),
  })
  const receiptAuthority = createApprovalReceiptAuthority({
    filePath: path.join(authorityDir, 'approval-receipts.json'),
    macKey: ensureCapabilitySigningKey('approval-receipt'),
    storeMacKey: ensureCapabilitySigningKey('approval-receipt-store'),
    keyId: 'approval-receipt-v1',
    lock: sharedLock,
  })
  const resolver = createCurrentProjectResolver({
    getOpenProjectId: () => openProjectId,
    readProject: (projectId) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps()),
  })
  const resolveProjectSelection = (selection: ProjectSelectionHandleV1) => {
    const projectId = openProjectId.trim()
    const record = projectId ? readWorkspaceProject(projectId, getWorkspaceRepositoryDeps()) : null
    if (!record || record.id !== projectId || record.immutableProjectUuid !== selection.immutableProjectUuid
      || record.projectGeneration !== selection.projectGeneration) {
      throw new Error('Project selection handle does not match the open project')
    }
    const digests = deriveProjectIdentityDigests(record)
    if (digests.canonicalRootDigest !== selection.canonicalRootDigest || digests.manifestDigest !== selection.manifestDigest) {
      throw new Error('Project selection handle is stale for the open project')
    }
    return {
      projectId,
      leasePrincipal: 'nomi-gui',
      sessionId: `nomi-gui:${selection.sessionNonce}`,
      connectionNonce: selection.sessionNonce,
      serverNonce: crypto.randomUUID(),
    }
  }
  const confirmGenerationInNomi = async ({ challengeToken }: { challengeToken: string }) => {
    const challenge = receiptAuthority.verifyChallenge(challengeToken)
    const target = rendererTargetIdentity()
    if (!target || !challenge.display?.model) return { confirmed: false, challengeId: challenge.challengeId }
    const result = await requestRenderer('generation.gate.confirm', {
      challengeId: challenge.challengeId,
      projectName: challenge.display.projectName,
      shotSummary: challenge.display.shotSummary,
      model: challenge.display.model,
      referenceCount: challenge.display.referenceCount,
      maximumCost: challenge.reservationPreview.maximum,
      currency: challenge.reservationPreview.currency,
      expiresAt: challenge.expiresAt,
    }, 60_000) as { confirmed?: unknown } | null
    if (result?.confirmed !== true) return { confirmed: false, challengeId: challenge.challengeId }
    const attestation = receiptAuthority.createMainProcessGestureAttestation(challengeToken, {
      ...target,
      decision: 'accept',
    })
    const receipt = receiptAuthority.mintReceipt(challengeToken, attestation)
    return {
      confirmed: true,
      challengeId: challenge.challengeId,
      receiptId: receipt.receipt.receiptId,
      receiptToken: receipt.token,
    }
  }
  return {
    projectLeaseAuthority: leaseAuthority,
    resolveProjectSelection,
    resolveCurrentProject: resolver,
    approvalReceiptAuthority: receiptAuthority,
    confirmGenerationInNomi,
    projectRevisionResolver: (projectId) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps())?.revision,
  }
}

/** renderer 上报当前打开的项目（打开/切换=id，关闭=''）。A/B 守卫据此拒绝直写打开中的工程。 */
export function setOpenProjectId(projectId: string): void {
  openProjectId = String(projectId || '').trim()
}

/** 当前进程 RPC 端口（未启动=null）。「接入助手卡」据此显示能力核就绪态。 */
export function getCapabilityPort(): number | null {
  return handle?.port ?? null
}

/** 组装本实例的 v2 广告：projectsRoot 取自 getProjectLocationState（与 runtimePaths 同源），心跳戳 = now。 */
function buildAdvert(port: number, token: string, projectsRoot: string): InstanceAdvertisement {
  const now = Date.now()
  return {
    version: 2,
    pid: process.pid,
    port,
    token,
    startedAt: now,
    projectsRoot,
    heartbeatAt: now,
    appVersion: typeof app.getVersion === 'function' ? app.getVersion() : '',
  }
}

/**
 * 启动能力核对外口。绝不拖垮 app 启动：任何失败只记日志、不抛（fail-open，与 applySystemProxy 同纪律）。
 */
export async function startCapabilityCore(
  runTask: RunTaskFn,
  fetchTaskResult: FetchTaskResultFn,
  authorities: {
    projectLeaseAuthority?: ProjectLeaseAuthority
    resolveCurrentProject?: DispatchContext['resolveCurrentProject']
    approvalReceiptAuthority?: ApprovalReceiptAuthority
    requestGenerationGate?: DispatchContext['requestGenerationGate']
    authorizeGeneration?: DispatchContext['authorizeGeneration']
    confirmGenerationInNomi?: import('./rpcServer').RpcServerOptions['confirmGenerationInNomi']
    generationPolicy?: McpGenerationPolicy
    generationContext?: (params: Record<string, unknown>) => unknown | Promise<unknown>
    projectRevisionResolver?: (projectId: string) => number | undefined
  } = {},
): Promise<void> {
  try {
    const token = ensureToken()
    const defaults = createDefaultAuthorities()
    handle = await startRpcServer({
      runTask,
      fetchTaskResult,
      isProjectOpen: (id) => Boolean(openProjectId) && id === openProjectId,
      productionRuns: getProductionRunService(),
      ...defaults,
      ...authorities,
    })
    const location = getProjectLocationState()
    advertisedLibrary = { projectsRoot: location.path, isDefault: location.source === 'default' }
    writeInstanceAdvertisement(buildAdvert(handle.port, token, location.path), advertisedLibrary.isDefault)
    // 心跳：周期重写广告（刷新 heartbeatAt），让 launcher 能把「活着但卡死/挂起」的 wedged 实例与健康实例分开，
    // 从而快速失败而非盲等 60s。unref 让它不拖住进程退出。
    heartbeatTimer = setInterval(() => {
      try {
        if (!handle) return
        writeInstanceAdvertisement(buildAdvert(handle.port, token, location.path), advertisedLibrary!.isDefault)
      } catch {
        /* 心跳写失败不致命：读者的 pid 存活校验兜底 */
      }
    }, HEARTBEAT_INTERVAL_MS)
    heartbeatTimer.unref?.()
    console.log(`[nomi:capability-core] RPC 监听 127.0.0.1:${handle.port}（库 ${location.path}）`)
  } catch (error) {
    console.error('[nomi:capability-core] 启动失败（不影响 app）:', error)
  }
}

/** 退出清理：停心跳 + 清广告（按本实例的命名空间文件名）+ 关 server。同步触发、不抛，绝不卡退出。 */
export function stopCapabilityCore(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (advertisedLibrary) {
    clearInstanceAdvertisement(advertisedLibrary.projectsRoot, advertisedLibrary.isDefault)
    advertisedLibrary = null
  }
  if (handle) {
    void handle.close()
    handle = null
  }
}
