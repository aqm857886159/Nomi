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
import { createProductionNotificationsListener } from './productionNotificationsDesktop'
import type { ProductionRun, RunEvent } from './productionRunTypes'

let shared: ProductionRunService | null = null

// P4 真供应商加固：额外的 run 事件监听器（appIntegration 注册它的锚检查点→再驱动反应）。放在 runtime 层
// 用 setter 注册（不是 appIntegration 直接组进 onEvents），是为了避开 appIntegration → runtime → appIntegration
// 的循环 import。onEvents 触发时同时喊通知监听器 + 这个（都自吞错，互不影响）。
let extraEventListener: ((events: RunEvent[], run: ProductionRun) => void) | null = null
export function setProductionRunEventListener(listener: ((events: RunEvent[], run: ProductionRun) => void) | null): void {
  extraEventListener = listener
}
function composedOnEvents(): (events: RunEvent[], run: ProductionRun) => void {
  const notifications = createProductionNotificationsListener()
  return (events, run) => {
    notifications(events, run)
    if (extraEventListener) {
      try { extraEventListener(events, run) } catch { /* 反应失败不影响 run 主流程 */ }
    }
  }
}

/** One in-process control plane for MCP, RPC, IPC and recovery. The repository remains the durable source of truth. */
export function getProductionRunService(): ProductionRunService {
  if (!shared) {
    const fixtureEnabled = isProductionRunE2eFixtureEnabled(process.env, Boolean(app?.isPackaged))
    if (fixtureEnabled) {
      const projectRootResolver = (projectId: string) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())
      const recoverIncompletePolicy = process.env.NOMI_E2E_PRODUCTION_MISSING_POLICY === '1'
      shared = createProductionRunService({
        projectRootResolver,
        onEvents: composedOnEvents(),
        requestRenderer: createProductionRunE2eRenderer({ projectRootResolver }),
        policyResolver: () => {
          if (recoverIncompletePolicy) {
            const settings = readAutomationPolicySettings()
            return {
              mode: settings.mode,
              trustedHosts: [...settings.trustedHosts],
              allowedProviders: [...settings.allowedProviders],
              allowedModels: [...settings.allowedModels],
              maxSpend: settings.maxSpend,
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
      shared = createProductionRunService({ onEvents: composedOnEvents() })
    }
  }
  return shared
}

export function resetProductionRunServiceForTests(): void {
  shared = null
}
