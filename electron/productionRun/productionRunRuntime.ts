import { app } from 'electron'

import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { createProductionRunService, type ProductionRunService } from './productionRunService'
import {
  createProductionRunE2eRenderer,
  isProductionRunE2eFixtureEnabled,
  PRODUCTION_E2E_FIXTURE_MODEL,
  PRODUCTION_E2E_FIXTURE_PROVIDER,
} from './productionRunE2eFixture'
import { readAutomationPolicySettings } from '../settings/automationPolicySettings'
import { currentProjectRevision, getApprovalReceiptAuthority } from '../capabilityCore/approvalReceiptRuntime'
import { createProductionNotificationsListener } from './productionNotificationsDesktop'
import type { ProductionRun, RunEvent } from './productionRunTypes'

let shared: ProductionRunService | null = null
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
  if (!shared) {
    // 付费门的人证装配（2026-09-10 根因修复）：**每一个**生产装配都必须带上进程内唯一的收据权威
    // 与项目版本解析器，否则 gate.decide 上的收据既验不了、也没人验 = 付费门直接放行。
    // 这两项在这里给一次，MCP stdio、GUI appIntegration、rpcServer、IPC、agentLane 都取的是这同一个
    // service 单例，于是没有哪个入口能绕开（R28：防线建在最早能拦住的那层，而不是各入口自己记得）。
    const receiptWiring = {
      approvalReceiptAuthority: getApprovalReceiptAuthority(),
      projectRevisionResolver: currentProjectRevision,
    }
    const fixtureEnabled = isProductionRunE2eFixtureEnabled(process.env, Boolean(app?.isPackaged))
    if (fixtureEnabled) {
      const projectRootResolver = (projectId: string) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())
      const recoverIncompletePolicy = process.env.NOMI_E2E_PRODUCTION_MISSING_POLICY === '1'
      shared = createProductionRunService({
        ...receiptWiring,
        projectRootResolver,
        onEvents: productionEvents(),
        requestRenderer: createProductionRunE2eRenderer({ projectRootResolver }),
        policyResolver: () => {
          if (recoverIncompletePolicy) {
            const settings = readAutomationPolicySettings()
            return {
              mode: settings.mode,
              trustedHosts: [...settings.trustedHosts],
              allowedProviders: [...settings.allowedProviders],
              allowedModels: [...settings.allowedModels],

              maxAttemptsPerJob: settings.maxAttemptsPerJob,
              minimizeUploads: settings.minimizeUploads,
            }
          }
          return {
            mode: 'balanced',
            trustedHosts: ['nomi'],
            allowedProviders: [PRODUCTION_E2E_FIXTURE_PROVIDER],
            allowedModels: [PRODUCTION_E2E_FIXTURE_MODEL],
            maxSpend: 0,
            maxAttemptsPerJob: 1,
            minimizeUploads: true,
          }
        },
      })
    } else {
      shared = createProductionRunService({ ...receiptWiring, onEvents: productionEvents() })
    }
  }
  return shared
}

export function resetProductionRunServiceForTests(): void {
  shared = null
}
