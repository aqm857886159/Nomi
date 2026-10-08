
import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { createProductionRunService, type ProductionRunService } from './productionRunService'
import {
  createProductionRunE2eRenderer,
  isProductionRunE2eFixtureEnabled,
  PRODUCTION_E2E_FIXTURE_MAX_SPEND,
  PRODUCTION_E2E_FIXTURE_MODEL,
  PRODUCTION_E2E_FIXTURE_PROVIDER,
} from './productionRunE2eFixture'
import { currentProjectRevision, getApprovalReceiptAuthority } from '../capabilityCore/approvalReceiptRuntime'
import { createProductionNotificationsListener } from './productionNotificationsDesktop'
import type { ProductionRun, RunEvent } from './productionRunTypes'
import { getRegisteredProductionRunService, registerProductionRunService, resetRegisteredProductionRunService } from './productionRunServiceRegistry'
const listeners = new Set<(run: ProductionRun) => void>()
export function subscribeProductionRunChanges(listener: (run: ProductionRun) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function productionEvents() {
  const notify = createProductionNotificationsListener()
  return (events: RunEvent[], run: ProductionRun) => {
    notify(events, run)
    for (const listener of listeners) listener(run)
  }
}

/** One in-process control plane for MCP, RPC, IPC and recovery. The repository remains the durable source of truth. */
export function getProductionRunService(): ProductionRunService {
  try {
    return getRegisteredProductionRunService()
  } catch {
    // 付费门的人证装配（2026-09-10 根因修复）：**每一个**生产装配都必须带上进程内唯一的收据权威
    // 与项目版本解析器，否则 gate.decide 上的收据既验不了、也没人验 = 付费门直接放行。
    // 这两项在这里给一次，MCP stdio、GUI appIntegration、rpcServer、IPC、agentLane 都取的是这同一个
    // service 单例，于是没有哪个入口能绕开（R28：防线建在最早能拦住的那层，而不是各入口自己记得）。
    const receiptWiring = {
      approvalReceiptAuthority: getApprovalReceiptAuthority(),
      projectRevisionResolver: currentProjectRevision,
    }
    const fixtureEnabled = isProductionRunE2eFixtureEnabled(process.env)
    if (fixtureEnabled) {
      const projectRootResolver = (projectId: string) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())
      registerProductionRunService(createProductionRunService({
        ...receiptWiring,
        projectRootResolver,
        onEvents: productionEvents(),
        requestRenderer: createProductionRunE2eRenderer({ projectRootResolver }),
        policyResolver: () => ({
          trustedHosts: ['nomi'],
          allowedProviders: [PRODUCTION_E2E_FIXTURE_PROVIDER],
          allowedModels: [PRODUCTION_E2E_FIXTURE_MODEL],
          // 2026-09-21 用户拍板：「改掉这个规则，规则哪里来的去哪里改，最小必要生成是允许的。」
          //
          // 这里曾经钉着 `maxSpend: 0`。夹具模式下**真正的**保险是「出站只认回环」
          // （`generationProviderBootstrap.safeFixtureBaseUrl` 只接受 127.0.0.1 / localhost / ::1，
          // 且要 `NOMI_E2E_PRODUCTION_FIXTURE=1`）——钱本来就花不出去。钉 0 是第二道重复保险，
          // 代价却是**有价确认在真机走查里永远走不通**：带价格的付款卡一律撞 policy-budget-exceeded，
          // 于是「卡上显示价 → 确认 → 账本记同一价」这条链从来没被真机验过。
          // 改成一个小的正数上限：既让有价确认走得通，又保住「夹具不许出现大额」的那层体检。
          maxSpend: PRODUCTION_E2E_FIXTURE_MAX_SPEND,
          maxAttemptsPerJob: 1,
          minimizeUploads: true,
        }),
      }))
    } else {
      registerProductionRunService(createProductionRunService({ ...receiptWiring, onEvents: productionEvents() }))
    }
  }
  return getRegisteredProductionRunService()
}

export function resetProductionRunServiceForTests(): void {
  resetRegisteredProductionRunService()
}
