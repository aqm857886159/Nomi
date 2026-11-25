import { expect, it } from 'vitest'
import type { StoryboardRequestTarget } from '../shared/agentCapabilities/generationInvocationContext'
import { createDocumentPlanAuthoring } from './generationDocumentPlan'

it('remembers 64 requests per authoring instance and refreshes only after a successful write', async () => {
  const projectId = 'project'
  const source = { documentId: 'story', revision: 1, contentHash: 'hash' }
  const target = (index: number): StoryboardRequestTarget => ({
    projectId, requestId: String(index), sourceDocumentId: source.documentId,
    sourceDocumentRevision: source.revision, sourceDocumentContentHash: source.contentHash,
    targetKind: 'storyboard', plans: [],
  })
  const authoring = createDocumentPlanAuthoring({
    requestRenderer: async (_op, payload) => ({ status: 'saved', designId: (payload as { designId: string }).designId }),
  })
  const save = (index: number, designId = `design-${index}`) => authoring.saveDocumentPlan(projectId, source, designId, [{
    shotId: 'shot-1',
    candidate: {
      candidateId: 'candidate', revision: 1, moduleId: 'video', providerId: 'provider',
      modelId: 'model', mode: 'text_to_video', prompt: 'A moving camera', parameters: {}, references: [],
    },
  }], target(index))
  const lookup = (index: number) => authoring.planToExtend(projectId, source, target(index), false)

  for (let index = 0; index < 64; index += 1) await save(index)
  expect(lookup(1)).toBe('design-1')
  await save(0, 'revised-design')
  await save(64)
  expect(lookup(1)).toBeUndefined()
  expect(lookup(0)).toBe('revised-design')
  expect(lookup(64)).toBe('design-64')
  expect(authoring.planToExtend('other-project', source, target(0), false)).toBeUndefined()
})
