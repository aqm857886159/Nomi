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

let shared: ProductionRunService | null = null

/** One in-process control plane for MCP, RPC, IPC and recovery. The repository remains the durable source of truth. */
export function getProductionRunService(): ProductionRunService {
  if (!shared) {
    const fixtureEnabled = isProductionRunE2eFixtureEnabled(process.env, Boolean(app?.isPackaged))
    if (fixtureEnabled) {
      const projectRootResolver = (projectId: string) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())
      shared = createProductionRunService({
        projectRootResolver,
        requestRenderer: createProductionRunE2eRenderer({ projectRootResolver }),
        policyResolver: () => ({
          mode: 'balanced',
          trustedHosts: ['nomi'],
          allowedProviders: [PRODUCTION_E2E_FIXTURE_PROVIDER],
          allowedModels: [PRODUCTION_E2E_FIXTURE_MODEL],
          maxSpend: 0,
          maxAttemptsPerJob: 1,
          minimizeUploads: true,
        }),
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
