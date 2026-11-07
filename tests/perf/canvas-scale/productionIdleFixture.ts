import { compileExecutionContract, type PlanCandidate } from '../../../electron/capabilityCore/executionContract'
import { createModuleRegistry } from '../../../electron/capabilityCore/moduleRegistry'
import { createProductionRunRepository } from '../../../electron/productionRun/productionRunRepository'
import { createProductionGenerationSubmission } from '../../../electron/productionRun/productionGenerationSubmission'
import { sealAndApproveProductionGeneration } from '../../../electron/productionRun/productionGenerationAuthorizationTestUtils'
import { landedAdmission } from '../../../electron/productionRun/landFirstTestUtils'

/** Exercise the real durable poll seam in the Electron main process with a zero-cost provider. */
export async function startProductionIdleFixture(root: string) {
  const now = () => '2026-08-23T00:03:00.000Z'
  const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true }
  const registry = createModuleRegistry([{ moduleId: 'generation.single-shot', version: '1.0.0', inputKinds: ['text'], outputKinds: ['image'], modes: ['text-to-image'],
    parameterSchema: {}, assetInputSchema: { references: { kind: 'image', max: 4 } },
    providers: [{ providerId: 'idle-fixture', models: [{ modelId: 'idle-model', modes: ['text-to-image'], parameterSchema: {}, capabilities }] }] }])
  const candidate: PlanCandidate = { candidateId: 'idle', revision: 1, moduleId: 'generation.single-shot', providerId: 'idle-fixture', modelId: 'idle-model', mode: 'text-to-image', prompt: 'Local pending fixture', parameters: {}, references: [] }
  const repository = createProductionRunRepository({ projectDirResolver: () => root, now })
  const input = { projectId: 'idle-project', operationId: 'idle-operation' }
  repository.createGenerationDraft({ ...input, origin: { host: 'semantic-mcp' }, candidate, policy: { trustedHosts: ['semantic-mcp'], allowedProviders: ['idle-fixture'], allowedModels: ['idle-model'], maxSpend: 0, maxAttemptsPerJob: 1 } })
  let submits = 0
  let queries = 0
  const provider = { providerId: 'idle-fixture', capabilities, buildRequest: (request: unknown) => request,
    submit: async () => ({ providerTaskId: `idle-task-${++submits}` }),
    query: async () => ({ status: 'processing', raw: { observed: ++queries } }) }
  sealAndApproveProductionGeneration({ repository, ...input, immutableProjectUuid: 'idle-uuid', projectGeneration: 1, projectRevision: 0,
    candidate, contract: compileExecutionContract(candidate, registry), providers: [provider], now: now() })
  const submission = createProductionGenerationSubmission({ repository, projectRoot: root, immutableProjectUuid: 'idle-uuid', projectGeneration: 1, intentMacKey: 'non-secret-fixture', beforeDispatch: () => undefined, now, provider })
  await submission.start({ ...input, admission: await landedAdmission(repository, input.projectId, input.operationId) })
  await submission.poll(input)
  return { poll: () => submission.poll(input), stats: () => ({ submits, queries, revision: repository.read(input.projectId, input.operationId)?.revision }) }
}
