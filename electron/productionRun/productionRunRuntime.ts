import { app } from 'electron'

import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { createProductionRunService, type ProductionRunService } from './productionRunService'
import {
  createProductionRunE2ePreflight,
  createProductionRunE2eRenderer,
  PRODUCTION_E2E_FIXTURE_MODEL,
  PRODUCTION_E2E_FIXTURE_PROVIDER,
} from './productionRunE2eFixture'
import { readAutomationPolicySettings } from '../settings/automationPolicySettings'

let shared: ProductionRunService | null = null

/** One in-process control plane for MCP, RPC, IPC and recovery. The repository remains the durable source of truth. */
export function getProductionRunService(): ProductionRunService {
  if (!shared) {
    const fixturePreflight = createProductionRunE2ePreflight(process.env, Boolean(app?.isPackaged))
    if (fixturePreflight) {
      const projectRootResolver = (projectId: string) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())
      const recoverIncompletePolicy = process.env.NOMI_E2E_PRODUCTION_MISSING_POLICY === '1'
      shared = createProductionRunService({
        projectRootResolver,
        requestRenderer: createProductionRunE2eRenderer({ projectRootResolver }),
        preflightProviderModel: fixturePreflight,
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
      shared = createProductionRunService()
    }
  }
  return shared
}

export function resetProductionRunServiceForTests(): void {
  shared = null
}
